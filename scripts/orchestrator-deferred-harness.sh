#!/bin/bash
# Test harness for the deferred outcomes in orchestrator-deferred.sh (HON-1414).
# Driven by scripts/orchestrator.deferred.test.ts. orchestrator-outcome-harness.sh
# is at its size cap, so these modes live here.
#
# Modes:
#   polls <reason> <commits> <pr_state>...
#     Poll 1 runs the handler for <reason> (clean | timeout | error) the way
#     monitor_workers does for a worker that just ended. Each later poll runs the
#     REAL process_deferred. Each <pr_state> is what gh answers on that poll, as
#     in orchestrator-outcome-harness.sh: OPEN | MERGED | CLOSED | NONE | ERROR.
#     Stubbed: gh, the Linear API, labels, the queue restore, worktree cleanup,
#     handle_failure and the commit count. The REAL spawn_worker runs against a
#     recording worktree-claude.sh. After each poll it prints
#     POLL:<n>:<deferred count>:<status-file .deferred JSON> and
#     CONSECUTIVE_FAILURES:<n>; at the end one WT_CALL / WT_CONTEXT line per
#     `wt auto` call and WORKER_RETRIED, then the log.
#     Environment:
#       HARNESS_NETWORK            end (the log ends in the network marker) or
#                                  mid (the marker, then ordinary output)
#       HARNESS_RETRIED            default 0, a first attempt
#       HARNESS_WT_PATH            the worktree the dirty check and the patch read
#       HARNESS_LOG_DIR            LOG_DIR, where a patch lands
#       HARNESS_COMMENT_FAILS      how many commentCreate calls fail first
#       HARNESS_LABEL_FAILS        how many label writes fail first
#       HARNESS_LINEAR_DOWN        polls (comma list) whose `{ viewer }` fails
#       HARNESS_NETWORK_RESPAWNED  seeds NETWORK_RESPAWNED
#       HARNESS_SHUTTING_DOWN      seeds SHUTTING_DOWN
#
#   reload
#     Seeds DEFERRED with entries that hold empty fields, runs the REAL
#     export_deferred_state and restore_deferred_state, and prints each entry
#     before and after with its fields bracketed.

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-}"
shift || true
ARGS=("$@")
set --

# shellcheck source=./orchestrator.sh
source "$HARNESS_DIR/orchestrator.sh"
# -e stays on, for the reason orchestrator-outcome-harness.sh gives.
set +u

MAIN_LOG=$(mktemp "${TMPDIR:-/tmp}/orchestrator-deferred-log.XXXXXXXX")
SPAWN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/orchestrator-deferred-spawn.XXXXXXXX")
trap 'cat "$MAIN_LOG"; rm -rf "$MAIN_LOG" "$SEEN_SKIPS_FILE" "$SPAWN_DIR"' EXIT

bracket() {
  local fields=() f out=""
  IFS="$DEFERRED_FS" read -r -a fields <<< "$1"
  for f in "${fields[@]}"; do out+="[$f]"; done
  echo "$out"
}

case "$MODE" in
  reload)
    DEFERRED=(
      "$(deferred_entry network HON-1 error uuid-1 branch-1 /logs/w1.log 0 "Title one" 1 60)"
      "$(deferred_entry probe HON-2 clean uuid-2 branch-2 /logs/w2.log 1 "Title two" "" 120)"
    )
    NETWORK_RESPAWNED="HON-7"
    for e in "${DEFERRED[@]}"; do echo "BEFORE:$(bracket "$e")"; done
    export_deferred_state
    DEFERRED=()
    NETWORK_RESPAWNED=""
    restore_deferred_state
    for e in "${DEFERRED[@]}"; do echo "AFTER:$(bracket "$e")"; done
    echo "RESPAWNED:$NETWORK_RESPAWNED"
    echo "LEFT_IN_ENV:${ORCHESTRATOR_RELOAD_DEFERRED-unset}"
    exit 0
    ;;

  polls)
    REASON="${ARGS[0]}"; COMMITS="${ARGS[1]}"
    POLL_STATES=("${ARGS[@]:2}")
    POLL=1
    PR_STATE="${POLL_STATES[0]}"

    count_commits() { echo "$COMMITS"; }
    detect_phase() { echo "pr-review"; }
    pr_ci_state() { echo "green"; }
    pr_for_branch() {
      [ "$PR_STATE" = "ERROR" ] && return 1
      [ "$PR_STATE" = "NONE" ] && return 0
      printf '%s\t%s\t%s\n' "$PR_STATE" "650" "https://github.com/kaupok/wobblepot/pull/650"
    }
    COMMENT_CALLS=0
    linear_api() {
      case "$1" in
        *viewer*)
          [[ ",${HARNESS_LINEAR_DOWN:-}," == *",$POLL,"* ]] && return 1
          ;;
        *commentCreate*)
          COMMENT_CALLS=$((COMMENT_CALLS + 1))
          [ "$COMMENT_CALLS" -le "${HARNESS_COMMENT_FAILS:-0}" ] && return 1
          echo "COMMENT:$(printf '%s' "${2:-}" | jq -r '.body' | head -1)" >> "$MAIN_LOG"
          ;;
      esac
      echo '{"data":{}}'
    }
    notify() { :; }
    LABEL_CALLS=0
    try_add_label() {
      LABEL_CALLS=$((LABEL_CALLS + 1))
      if [ "$LABEL_CALLS" -le "${HARNESS_LABEL_FAILS:-0}" ]; then
        LINEAR_WRITES_FAILED+=" label"
        return 0
      fi
      echo "LABEL:$2" >> "$MAIN_LOG"
    }
    restore_queue_if_in_progress() { echo "RESTORE_QUEUED:$2" >> "$MAIN_LOG"; }
    cleanup_worker_worktree() { echo "CLEANUP:${1}:${2:-false}" >> "$MAIN_LOG"; }
    handle_failure() { echo "HANDLE_FAILURE:${6}" >> "$MAIN_LOG"; }
    check_lost_branch() { :; }
    get_worktree_path() { echo "${HARNESS_WT_PATH:-/nonexistent/orchestrator-deferred-worktree}"; }

    SHUTTING_DOWN="${HARNESS_SHUTTING_DOWN:-false}"
    NETWORK_RESPAWNED="${HARNESS_NETWORK_RESPAWNED:-}"
    RETRIED="${HARNESS_RETRIED:-0}"
    mkdir -p "$SPAWN_DIR/repo" "$SPAWN_DIR/scripts" "$SPAWN_DIR/logs" "$SPAWN_DIR/calls"
    REPO_ROOT="$SPAWN_DIR/repo"
    SCRIPT_DIR="$SPAWN_DIR/scripts"
    LOG_DIR="${HARNESS_LOG_DIR:-$SPAWN_DIR/logs}"
    STATUS_FILE="$SPAWN_DIR/status.json"
    DRY_RUN=false
    cat > "$SCRIPT_DIR/worktree-claude.sh" <<EOF
#!/bin/sh
n=\$(ls "$SPAWN_DIR/calls" | grep -c '\.args\$')
n=\$((n + 1))
printf '%s' "\$ORCHESTRATOR_RETRY_CONTEXT" > "$SPAWN_DIR/calls/\$n.ctx"
printf '%s' "\$*" > "$SPAWN_DIR/calls/\$n.args"
EOF
    chmod +x "$SCRIPT_DIR/worktree-claude.sh"

    WORKER_LOG="$SPAWN_DIR/worker.log"
    echo "[auto-implement] Phase 6/7: Addressing reviews" > "$WORKER_LOG"
    case "${HARNESS_NETWORK:-}" in
      end) echo "API Error: Can't reach the API server (ENOTFOUND)" >> "$WORKER_LOG" ;;
      mid)
        echo "API Error: Can't reach the API server (ENOTFOUND)" >> "$WORKER_LOG"
        printf 'ordinary output %s\n' 1 2 3 4 5 >> "$WORKER_LOG"
        ;;
    esac

    report_poll() {
      write_status_file
      echo "POLL:$POLL:${#DEFERRED[@]}:$(jq -c '.deferred' "$STATUS_FILE")" >> "$MAIN_LOG"
      echo "CONSECUTIVE_FAILURES:$CONSECUTIVE_FAILURES" >> "$MAIN_LOG"
    }

    case "$REASON" in
      clean) handle_success HON-999 uuid-999 test-branch "$WORKER_LOG" "$RETRIED" "Fixture title" 2>/dev/null ;;
      timeout) handle_timeout HON-999 uuid-999 test-branch "$WORKER_LOG" "$RETRIED" "Fixture title" 3600 2>/dev/null ;;
      *) handle_error_exit HON-999 uuid-999 test-branch "$WORKER_LOG" "$RETRIED" "Fixture title" 1 2>/dev/null ;;
    esac
    report_poll
    while [ "$POLL" -lt "${#POLL_STATES[@]}" ]; do
      PR_STATE="${POLL_STATES[$POLL]}"
      POLL=$((POLL + 1))
      process_deferred 2>/dev/null
      report_poll
    done

    for pid in ${WORKER_PIDS[@]+"${WORKER_PIDS[@]}"}; do wait "$pid" 2>/dev/null || true; done
    n=1
    while [ -f "$SPAWN_DIR/calls/$n.args" ]; do
      echo "WT_CALL:$n:$(cat "$SPAWN_DIR/calls/$n.args")" >> "$MAIN_LOG"
      echo "WT_CONTEXT:$n:$(tr '\n' ' ' < "$SPAWN_DIR/calls/$n.ctx")" >> "$MAIN_LOG"
      n=$((n + 1))
    done
    echo "WORKER_RETRIED:${WORKER_RETRIED[*]}" >> "$MAIN_LOG"
    exit 0
    ;;
esac

echo "Unknown mode: $MODE" >&2
exit 2
