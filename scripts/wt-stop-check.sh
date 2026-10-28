# shellcheck shell=bash
# `wt stop`'s drain check (HON-575 B4). Sourced by worktree-claude.sh.
#
# A drain that ends early fails in two ways, and neither one makes a noise: the
# `claude` workers keep running with no orchestrator, and their issues stay In
# Progress and assigned, the state select_next_issue skips forever (HON-572,
# HON-1067). So every stop proves its own drain: cmd_stop takes a snapshot of
# the workers before its first signal and checks each one after the exit.

# The workers a stop must drain, from the orchestrator's status file:
# `<issue>\t<pid>` per line. Prints nothing when the file is missing or
# unreadable. Take it before the first signal, because the orchestrator deletes
# the file on exit.
stop_drain_snapshot() {
  jq -r '.workers[]? | select(.issue != null and .pid != null) | "\(.issue)\t\(.pid)"' "$1" 2>/dev/null || true
}

# The snapshot lines whose PID still runs `claude`. Checks the command, not only
# the PID, so a PID the system gave to a new process does not count. The PID is
# the `wt auto` shell (`worktree-claude.sh auto`), which matches, and `claude`
# runs as its child so the shell can continue it after a network drop
# (HON-1413).
stop_drain_orphans() {
  local issue pid cmd
  while IFS=$'\t' read -r issue pid; do
    [ -z "$pid" ] && continue
    cmd=$(ps -p "$pid" -o command= 2>/dev/null) || continue
    case "$cmd" in
      *claude*) printf '%s\t%s\n' "$issue" "$pid" ;;
    esac
  done <<< "$1"
}

# Each snapshot issue's state in Linear: `<issue>\t<state>\t<assignee>` per
# line. A failed lookup prints an empty state, which stop_drain_verdict reports
# as unchecked rather than as passed.
stop_drain_issue_states() {
  local issue pid payload response state assignee
  while IFS=$'\t' read -r issue pid; do
    [ -z "$issue" ] && continue
    state="" assignee=""
    if [ -n "${LINEAR_API_KEY:-}" ]; then
      payload=$(jq -nc --arg id "$issue" \
        '{query: "query($id: String!) { issue(id: $id) { state { name } assignee { name } } }", variables: {id: $id}}')
      if response=$(curl -s --max-time 15 -X POST "https://api.linear.app/graphql" \
        -H "Content-Type: application/json" \
        -H "Authorization: $LINEAR_API_KEY" \
        -d "$payload"); then
        state=$(printf '%s' "$response" | jq -r '.data.issue.state.name // empty' 2>/dev/null || true)
        assignee=$(printf '%s' "$response" | jq -r '.data.issue.assignee.name // empty' 2>/dev/null || true)
      fi
    fi
    printf '%s\t%s\t%s\n' "$issue" "$state" "$assignee"
  done <<< "$1"
}

# Pure verdict over the three lists above. Prints one line per problem and a
# summary line; returns 1 when a worker or an issue failed the check.
#
# An issue passes in any state but two: In Progress, and Queued with an
# assignee. Both keep it from the picker. In Review and Done are normal ends: a
# worker can finish during the graceful wait, and a drained strand with a PR
# stays In Review (HON-1077).
stop_drain_verdict() {
  local snapshot="$1" orphans="$2" states="$3"
  local total=0 failed=0 unchecked=0 issue pid state assignee

  [ -z "$snapshot" ] && { echo "Drain check: no workers were active"; return 0; }
  total=$(printf '%s\n' "$snapshot" | grep -c . || true)

  while IFS=$'\t' read -r issue pid; do
    [ -z "$issue" ] && continue
    echo "  FAIL $issue: its worker (PID $pid) still runs. Stop it: pkill -P $pid; kill $pid"
    failed=$((failed + 1))
  done <<< "$orphans"

  while IFS=$'\t' read -r issue state assignee; do
    [ -z "$issue" ] && continue
    if [ -z "$state" ]; then
      echo "  ???? $issue: could not read its state from Linear. Check that it is not In Progress"
      unchecked=$((unchecked + 1))
    elif [ "$state" = "In Progress" ]; then
      echo "  FAIL $issue: still In Progress${assignee:+ and assigned to $assignee}. Move it to Queued and clear the assignee"
      failed=$((failed + 1))
    elif [ "$state" = "Queued" ] && [ -n "$assignee" ]; then
      echo "  FAIL $issue: Queued but assigned to $assignee, so the orchestrator skips it. Clear the assignee"
      failed=$((failed + 1))
    fi
  done <<< "$states"

  if [ "$failed" -gt 0 ]; then
    echo "Drain check: $failed problem(s) across $total worker(s)"
    return 1
  fi
  if [ "$unchecked" -gt 0 ]; then
    echo "Drain check: no worker left running; $unchecked of $total issue(s) unchecked"
    return 0
  fi
  echo "Drain check: passed ($total worker(s): none left running, no issue stuck)"
}

# The whole check, for cmd_stop. Never fails the stop itself: the orchestrator
# is already gone, so the check only reports.
stop_drain_check() {
  local snapshot="$1" orphans states
  orphans=$(stop_drain_orphans "$snapshot")
  states=$(stop_drain_issue_states "$snapshot")
  stop_drain_verdict "$snapshot" "$orphans" "$states" || true
}
