#!/bin/bash
# Deferred outcomes (HON-1414). Sourced by orchestrator.sh, never run alone.
#
# A worker that died while GitHub or Linear was unreachable had its outcome
# recorded at once. probe_worker_pr failed, so the run got no finish attempt,
# and record_stranded could neither comment nor label. Nothing then finished
# the run: on 2026-10-28 five runs waited for a human that way, with no signal
# for the human to look.
#
# So an outcome now waits for the network. Each outcome handler calls
# defer_outcome right after its probe. A deferred worker keeps its worktree and
# joins DEFERRED; process_deferred replays it through the same handler on the
# first poll that reaches Linear, so the existing rules decide it. A replay
# whose probe fails again defers itself again. Nothing on a deferred path
# deletes a branch, a worktree or a Neon branch (the HON-573 / HON-1064 rule).
#
# A network crash also gets one respawn on its branch, outside the one finish
# attempt, with its uncommitted work saved as a patch the retry context names.

# One entry per deferred worker, fields joined by DEFERRED_FS. Field 0 is the
# kind (network | probe | linear) and field 1 the issue ID. Then:
#   network, probe: reason (clean | timeout | error), uuid, branch, log file,
#                   retried, title, exit code, duration in seconds, finishing
#                   (WORKER_FINISHING), first deferred at (epoch)
#   linear:         the failed steps (comment label queue), then the twelve
#                   record_stranded arguments
DEFERRED=()
DEFERRED_FS=$'\x1f'
# Issues that had their network respawn, comma-separated: one each.
NETWORK_RESPAWNED=""
# true while a replay handles a network crash, so note_consecutive_failure
# skips it: an outage is not a run that failed to ship.
NETWORK_CRASH=false
# true while process_deferred replays an outcome; the worker is gone from
# WORKER_*, so worker_duration_secs reads REPLAY_DURATION_SECS instead.
REPLAYING=false
REPLAY_DURATION_SECS=""
REPLAY_DEFERRED_AT=""
# WORKER_FINISHING of the outcome in hand: set by monitor_workers for a live
# worker and by replay_deferred, so a network respawn of a finish attempt is
# still one when a force stop drains it (HON-1077).
OUTCOME_FINISHING=0
# How long an outcome may wait for gh, in seconds. Past it, or with no gh at
# all, waiting proves nothing: the outcome is recorded without the PR lookup,
# as before HON-1414, so a gh that stays signed out cannot hold a worker slot
# for good. 30 minutes is the longest wait `wt auto` spends on the Claude API
# (WT_AUTO_NETWORK_WAIT).
DEFER_MAX_AGE="${ORCHESTRATOR_DEFER_MAX_AGE:-1800}"
# The Linear writes of a recorded strand that failed, as step names. Appended
# by record_stranded, try_add_label, restore_queue_if_in_progress and
# move_issue_unassigned; cleared and read only by strand_worker and the linear
# replay.
LINEAR_WRITES_FAILED=""

# The marker HON-1413's wt_auto_network_drop (worktree-auto-run.sh) matches, in
# the same scope: the last lines of the log. A worker that quotes the marker in
# ordinary work prints it mid-log, where it does not match. A here-string, not
# a pipe into `grep -q`, for the pipefail reason worker_hit_neon_cap gives.
NETWORK_CRASH_RE="Can('|’)t reach the API server|API Error.*(ENOTFOUND|ECONNRESET)"
worker_hit_network_crash() {
  local log_file="$1"
  [ -n "$log_file" ] && [ -f "$log_file" ] || return 1
  grep -qE "$NETWORK_CRASH_RE" <<<"$(tail -n 5 "$log_file" 2>/dev/null)"
}

gh_installed() {
  command -v gh > /dev/null 2>&1
}

deferred_entry() {
  local IFS="$DEFERRED_FS"
  printf '%s' "$*"
}

# Called by handle_success, handle_timeout and handle_error_exit after
# probe_worker_pr. Returns 0 when the caller must stop: the outcome is deferred,
# or the network respawn ran. Returns 1 to let the caller record the outcome.
#
# Usage: defer_outcome <reason> <issue_id> <uuid> <branch> <log> <retried> <title> <exit_code> <secs>
defer_outcome() {
  local reason="$1" issue_id="$2" issue_uuid="$3" branch="$4" log_file="$5"
  local retried="$6" title="$7" exit_code="$8" secs="$9"
  local kind=probe
  # A timeout is the orchestrator's own kill, whatever the log ends in.
  if [ "$reason" != timeout ] && worker_hit_network_crash "$log_file"; then
    kind=network
  fi

  local now deferred_at
  now=$(date +%s)
  deferred_at="$now"
  [ "$REPLAYING" = true ] && deferred_at="${REPLAY_DEFERRED_AT:-$now}"
  # A network crash is always deferred once, so its replay waits a poll.
  if [ "$WORKER_PR_PROBE_OK" != true ] && { [ "$kind" = probe ] || [ "$REPLAYING" = true ]; } &&
     { ! gh_installed || { [ "$REPLAYING" = true ] && [ $((now - deferred_at)) -ge "$DEFER_MAX_AGE" ]; }; }; then
    log WARN "[DEFERRED] $issue_id: gh is missing or has not answered for ${DEFER_MAX_AGE}s — recording the outcome without the PR lookup"
    [ "$kind" = network ] && NETWORK_CRASH=true
    return 1
  fi

  # A network crash waits even when gh answered at once: the worker could not
  # reach the API, and a respawn now would likely die the same way.
  if [ "$WORKER_PR_PROBE_OK" != true ] || { [ "$kind" = network ] && [ "$REPLAYING" != true ]; }; then
    DEFERRED+=("$(deferred_entry "$kind" "$issue_id" "$reason" "$issue_uuid" "$branch" "$log_file" \
      "$retried" "$title" "$exit_code" "$secs" "${OUTCOME_FINISHING:-0}" "$deferred_at")")
    local why="the PR lookup failed"
    [ "$kind" = network ] && why="the worker lost the network"
    log WARN "[DEFERRED] $issue_id: $why — the outcome waits for a poll that reaches Linear and GitHub; worktree kept"
    return 0
  fi

  [ "$kind" = network ] || return 1
  NETWORK_CRASH=true
  [ "$WORKER_PR_MERGED" = true ] && return 1
  network_respawn "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "$title" "$secs"
}

# Save the worktree's uncommitted work, tracked and untracked, as a patch in
# LOG_DIR, and print its path. Prints nothing when there is nothing to save.
# Returns 1 when git failed, so the caller keeps the worktree.
save_uncommitted_patch() {
  local issue_id="$1" branch="$2"
  worktree_has_uncommitted "$branch" || return 0
  local wt_path patch
  wt_path=$(get_worktree_path "$branch")
  patch="$LOG_DIR/${issue_id}-uncommitted-$(date '+%Y%m%d-%H%M%S').patch"
  # Intent-to-add puts untracked files into `git diff`. Only the index of a
  # worktree that is removed next changes.
  if ! { git -C "$wt_path" add --intent-to-add --all . &&
         git -C "$wt_path" diff --binary HEAD > "$patch"; } 2>/dev/null; then
    rm -f "$patch"
    log WARN "Could not save the uncommitted work of $issue_id — keeping its worktree"
    return 1
  fi
  if [ -s "$patch" ]; then
    printf '%s' "$patch"
  else
    rm -f "$patch"
  fi
  return 0
}

# One respawn on the same branch for a network crash, whatever its commit
# count: no triage, and WORKER_RETRIED keeps its value, so the run keeps its
# one finish attempt. Returns 1, before it changes anything, when the issue had
# its network respawn already or the orchestrator is shutting down.
network_respawn() {
  local issue_id="$1" issue_uuid="$2" branch="$3" log_file="$4"
  local retried="$5" title="$6" secs="$7"
  [ "$SHUTTING_DOWN" = false ] || return 1
  case ",$NETWORK_RESPAWNED," in *",$issue_id,"*) return 1 ;; esac

  local commits phase duration_str patch=""
  commits=$(count_commits "$branch")
  phase=$(detect_phase "$log_file" "$branch")
  duration_str=$(format_duration "$secs")
  patch=$(save_uncommitted_patch "$issue_id" "$branch") || return 1
  NETWORK_RESPAWNED="${NETWORK_RESPAWNED:+$NETWORK_RESPAWNED,}$issue_id"

  log WARN "[OUTCOME] $issue_id NETWORK ${duration_str} ${commits}-commits phase=$phase pr=${WORKER_PR_REF} triage=RESPAWN"
  note_outcome NETWORK "$commits"
  [ -z "$patch" ] || log INFO "Saved the uncommitted work of $issue_id to $patch"

  local pr_note="No PR is open yet."
  [ -n "$WORKER_PR_NUMBER" ] && pr_note="PR ${WORKER_PR_REF} is ${WORKER_PR_STATE:-open}: $WORKER_PR_URL"
  local patch_note="The worktree had no uncommitted work."
  [ -n "$patch" ] && patch_note="Its uncommitted work is saved at $patch. Apply it first: git apply $patch"

  log INFO "Respawning $issue_id after a network drop, on $branch"
  # keep_branch=true: the git branch and its Neon branch carry the work.
  cleanup_worker_worktree "$branch" true
  spawn_worker "$issue_uuid" "$issue_id" "$branch" "$title" "$retried" \
    "$(printf '%s\n' \
      "Retry context: the previous attempt stopped in phase $phase after $duration_str with $commits commit(s), because the network dropped (the API server could not be reached)." \
      "$pr_note" "$patch_note" \
      "Continue the cycle from where it stopped.")" "${OUTCOME_FINISHING:-0}"
  return 0
}

# Called by strand_worker after it records a strand for a human: keep the
# Linear writes that failed, so the next poll that reaches Linear makes them.
# Usage: defer_linear_writes <record_stranded's twelve arguments>
defer_linear_writes() {
  [ -n "$LINEAR_WRITES_FAILED" ] || return 0
  local steps="${LINEAR_WRITES_FAILED# }"
  DEFERRED+=("$(deferred_entry linear "$2" "$steps" "$@")")
  log WARN "[DEFERRED] $2: Linear writes failed ($steps) — retrying them on the next poll that reaches Linear"
  return 0
}

replay_deferred() {
  local fields=()
  IFS="$DEFERRED_FS" read -r -a fields <<< "$1"
  local kind="${fields[0]}" issue_id="${fields[1]}"
  log INFO "Replaying the deferred outcome of $issue_id ($kind)"

  if [ "$kind" = linear ]; then
    local steps=" ${fields[2]} " args=("${fields[@]:3}")
    # Twelve arguments; a trailing empty one is lost in the split.
    while [ ${#args[@]} -lt 12 ]; do args+=(""); done
    LINEAR_WRITES_FAILED=""
    local rs_steps="${steps/ queue / }"
    rs_steps="${rs_steps# }"; rs_steps="${rs_steps% }"
    [ -z "$rs_steps" ] || record_stranded "${args[@]}" "$rs_steps"
    case "$steps" in *" queue "*) restore_queue_if_in_progress "${args[0]}" "$issue_id" ;; esac
    defer_linear_writes "${args[@]}"
    return 0
  fi

  local reason="${fields[2]}" issue_uuid="${fields[3]}" branch="${fields[4]}"
  local log_file="${fields[5]}" retried="${fields[6]}" title="${fields[7]}"
  local exit_code="${fields[8]:-}" secs="${fields[9]:-0}"
  LAST_OUTCOME=""
  LAST_OUTCOME_COMMITS=""
  REPLAYING=true
  REPLAY_DURATION_SECS="$secs"
  OUTCOME_FINISHING="${fields[10]:-0}"
  REPLAY_DEFERRED_AT="${fields[11]:-}"
  case "$reason" in
    clean) handle_success "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "$title" ;;
    timeout) handle_timeout "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "$title" "$secs" ;;
    *) handle_error_exit "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "$title" "$exit_code" ;;
  esac
  REPLAYING=false
  REPLAY_DURATION_SECS=""
  REPLAY_DEFERRED_AT=""
  OUTCOME_FINISHING=0
  NETWORK_CRASH=false
  check_lost_branch "$issue_id" "$branch" "$LAST_OUTCOME" "$LAST_OUTCOME_COMMITS"
  return 0
}

# Once per poll, before monitor_workers, so an outcome is never replayed on the
# poll that deferred it. A cheap Linear query stands in for "the network is
# back"; gh is asked by each replay's own probe.
process_deferred() {
  [ ${#DEFERRED[@]} -gt 0 ] || return 0
  if ! linear_api '{ viewer { id } }' > /dev/null 2>&1; then
    log DEBUG "Linear does not answer yet; ${#DEFERRED[@]} deferred outcome(s) wait"
    return 0
  fi
  local entries=("${DEFERRED[@]}") entry
  DEFERRED=()
  for entry in "${entries[@]}"; do
    replay_deferred "$entry"
  done
  write_status_file
}

# The worker slots deferred entries hold, for the spawn gate. A network or
# probe entry keeps its worktree and Neon branch, and its replay may respawn on
# them; a linear entry is a recorded strand and holds no slot.
deferred_slots() {
  local entry n=0
  for entry in ${DEFERRED[@]+"${DEFERRED[@]}"}; do
    case "$entry" in "linear$DEFERRED_FS"*) ;; *) n=$((n + 1)) ;; esac
  done
  echo "$n"
}

# `[{issue, kind}]` for orchestrator-status.json, which `wt watch` reads.
deferred_json() {
  local entry fields=()
  for entry in ${DEFERRED[@]+"${DEFERRED[@]}"}; do
    IFS="$DEFERRED_FS" read -r -a fields <<< "$entry"
    printf '%s\t%s\n' "${fields[1]}" "${fields[0]}"
  done | jq -R -s -c 'split("\n") | map(select(. != "") | split("\t") | {issue: .[0], kind: .[1]})'
}

# The reload hand-over (reload_if_code_changed, restore_reload_state). Entries
# are joined by RS: no field holds one.
export_deferred_state() {
  local IFS=$'\x1e' joined=""
  [ ${#DEFERRED[@]} -eq 0 ] || joined="${DEFERRED[*]}"
  export ORCHESTRATOR_RELOAD_DEFERRED="$joined"
  export ORCHESTRATOR_RELOAD_NETWORK_RESPAWNED="$NETWORK_RESPAWNED"
}

restore_deferred_state() {
  DEFERRED=()
  if [ -n "${ORCHESTRATOR_RELOAD_DEFERRED:-}" ]; then
    IFS=$'\x1e' read -r -a DEFERRED <<< "$ORCHESTRATOR_RELOAD_DEFERRED"
  fi
  NETWORK_RESPAWNED="${ORCHESTRATOR_RELOAD_NETWORK_RESPAWNED:-}"
  unset ORCHESTRATOR_RELOAD_DEFERRED ORCHESTRATOR_RELOAD_NETWORK_RESPAWNED
}

# At exit: what a stop or --once leaves unrecorded. Each keeps its worktree.
warn_deferred_left() {
  [ ${#DEFERRED[@]} -gt 0 ] || return 0
  log WARN "Exiting with ${#DEFERRED[@]} deferred outcome(s) unrecorded: $(deferred_json | jq -r 'map(.issue) | join(", ")') — their worktrees are kept"
}
