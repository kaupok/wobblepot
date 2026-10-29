#!/bin/bash
# Code reload (HON-861) and the worker handoff (HON-1457). Sourced by
# orchestrator.sh. Run alone only as `orchestrator-reload.sh --check-handoff
# <file>`, which the old image runs on the new code before it execs.
#
# The orchestrator runs for days and merges changes to its own code, but bash
# loads a script once: on 2026-09-30 it spent a day polling Todo after PR #931
# had switched it to Queued, because nobody ran `wt stop` / `wt start`. So a
# poll re-execs the script when the code on disk has changed.
#
# Running workers do not hold the reload back. It used to wait for them, and
# claim nothing meanwhile: on 2026-10-28 two such drains left about 10% of the
# slot-hours empty, and HON-1427's fast-forward made every merged orchestrator
# change start one. Now the per-worker arrays go into a handoff file, and the
# new image adopts the workers. exec keeps the PID, so they stay its children.

# The handoff format. A change to the fields bumps it: check_worker_handoff
# then refuses a file the old image wrote, and the reload falls back to the
# drain (claim nothing new until every worker finishes, then exec).
RELOAD_HANDOFF_VERSION=1
RELOAD_WORKERS_FILE="${WORKTREE_BASE:-$HOME/.worktrees/wobblepot}/orchestrator-reload-workers.json"

# A checksum of ORCHESTRATOR_CODE_FILES, or nothing when one is unreadable (a
# checkout mid-switch), which callers treat as "not now". cksum because it is
# POSIX: macOS and Linux spell every sha tool differently.
code_fingerprint() {
  local f
  for f in "${ORCHESTRATOR_CODE_FILES[@]}"; do
    [ -r "$f" ] || return 0
  done
  cat "${ORCHESTRATOR_CODE_FILES[@]}" 2>/dev/null | cksum | awk '{print $1 "-" $2}' || true
}

# The exec itself, alone in a function so the test harness can observe a reload
# without replacing its own process.
reload_exec() {
  exec "$@"
}

# True when every code file is tracked, unmodified, and checked out on `main`.
# The main checkout is also the operator's working copy, so what is on disk
# there may be a half-finished edit or another branch; only committed main is
# code this process should pick up unattended. Each file is asked from its own
# directory, so an absolute path never has to match git's view of the toplevel
# (macOS /var vs /private/var).
code_is_committed_main() {
  local f dir name
  for f in "${ORCHESTRATOR_CODE_FILES[@]}"; do
    dir=$(dirname "$f"); name=$(basename "$f")
    [ "$(git -C "$dir" symbolic-ref --short -q HEAD 2>/dev/null)" = main ] || return 1
    git -C "$dir" ls-files --error-unmatch -- "$name" >/dev/null 2>&1 || return 1
    git -C "$dir" diff --quiet HEAD -- "$name" >/dev/null 2>&1 || return 1
  done
  return 0
}

# ─── Worker handoff (HON-1457) ───────────────────────────────────────────────

# Write the per-worker arrays to RELOAD_WORKERS_FILE, one object per worker,
# then ask the NEW code on disk whether it can read them. Returns 1, with no
# file left behind, when the write fails or the new code refuses; $1 names the
# variable that receives the reason.
write_worker_handoff() {
  local __reason_var="$1" i=0 workers="" out
  while [ $i -lt ${#WORKER_PIDS[@]} ]; do
    workers+=$(jq -n -c \
      --arg pid "${WORKER_PIDS[$i]}" \
      --arg issue "${WORKER_ISSUES[$i]:-}" \
      --arg issue_uuid "${WORKER_ISSUE_UUIDS[$i]:-}" \
      --arg branch "${WORKER_BRANCHES[$i]:-}" \
      --arg log "${WORKER_LOGS[$i]:-}" \
      --arg start_time "${WORKER_START_TIMES[$i]:-}" \
      --arg retried "${WORKER_RETRIED[$i]:-0}" \
      --arg title "${WORKER_TITLES[$i]:-}" \
      --arg reported_at "${WORKER_REPORTED_AT[$i]:-0}" \
      --arg reported_sig "${WORKER_REPORTED_SIG[$i]:-}" \
      --arg finishing "${WORKER_FINISHING[$i]:-0}" \
      '{pid: ($pid | tonumber), issue: $issue, issue_uuid: $issue_uuid, branch: $branch,
        log: $log, start_time: ($start_time | tonumber), retried: $retried, title: $title,
        reported_at: ($reported_at | tonumber), reported_sig: $reported_sig, finishing: $finishing}' \
      2>/dev/null) || { printf -v "$__reason_var" '%s' "worker ${WORKER_ISSUES[$i]:-$i} has a non-numeric PID or start time"; return 1; }
    workers+=$'\n'
    i=$((i + 1))
  done

  local tmp="$RELOAD_WORKERS_FILE.tmp.$$"
  if ! printf '%s' "$workers" \
       | jq -s --argjson version "$RELOAD_HANDOFF_VERSION" '{version: $version, workers: .}' > "$tmp" 2>/dev/null \
     || ! mv -f "$tmp" "$RELOAD_WORKERS_FILE" 2>/dev/null; then
    rm -f "$tmp"
    printf -v "$__reason_var" '%s' "could not write $RELOAD_WORKERS_FILE"
    return 1
  fi

  # The new code decides what it can read, so a format change falls back to
  # the drain instead of an image that has lost track of its workers.
  if ! out=$("$BASH" "$SCRIPT_DIR/orchestrator-reload.sh" --check-handoff "$RELOAD_WORKERS_FILE" 2>&1); then
    rm -f "$RELOAD_WORKERS_FILE"
    printf -v "$__reason_var" '%s' "the new code refused the handoff: ${out:-no reason given}"
    return 1
  fi
  return 0
}

# Exit 0 when $1 is a handoff this code can adopt; otherwise print why.
check_worker_handoff() {
  local file="$1" version
  version=$(jq -r '.version // empty' "$file" 2>/dev/null) || { echo "not valid JSON"; return 1; }
  [ "$version" = "$RELOAD_HANDOFF_VERSION" ] \
    || { echo "version ${version:-missing}, this code reads $RELOAD_HANDOFF_VERSION"; return 1; }
  jq -e '.workers | type == "array" and all(.[];
      (.pid | type == "number") and (.start_time | type == "number")
      and (.reported_at | type == "number") and (.log | type == "string"))' "$file" >/dev/null 2>&1 \
    || { echo "a worker entry lacks a numeric pid, start_time or reported_at"; return 1; }
}

# In an image a reload started with workers running: rebuild the per-worker
# arrays from the handoff, then delete it. The fields come out NUL-separated,
# so a title holding a tab or a newline reads back whole.
restore_worker_handoff() {
  local file="${ORCHESTRATOR_RELOAD_WORKERS_FILE:-}"
  unset ORCHESTRATOR_RELOAD_WORKERS_FILE
  [ -n "$file" ] || return 0

  local reason
  if ! reason=$(check_worker_handoff "$file"); then
    # write_worker_handoff ran this same check on this same code, so only a
    # file changed between the two reaches here.
    log ERROR "Could not adopt the running workers from $file ($reason); they run on unmonitored"
    rm -f "$file"
    return 0
  fi

  local fields=() value
  while IFS= read -r -d '' value; do
    fields+=("$value")
  done < <(jq -j '.workers[] | (.pid, .issue, .issue_uuid, .branch, .log, .start_time,
    .retried, .title, .reported_at, .reported_sig, .finishing) | tostring + "\u0000"' "$file")
  rm -f "$file"

  local i=0 n
  while [ $((i + 10)) -lt ${#fields[@]} ]; do
    n=${#WORKER_PIDS[@]}
    WORKER_PIDS[$n]="${fields[$i]}"
    WORKER_ISSUES[$n]="${fields[$((i + 1))]}"
    WORKER_ISSUE_UUIDS[$n]="${fields[$((i + 2))]}"
    WORKER_BRANCHES[$n]="${fields[$((i + 3))]}"
    WORKER_LOGS[$n]="${fields[$((i + 4))]}"
    WORKER_START_TIMES[$n]="${fields[$((i + 5))]}"
    WORKER_RETRIED[$n]="${fields[$((i + 6))]}"
    WORKER_TITLES[$n]="${fields[$((i + 7))]}"
    WORKER_REPORTED_AT[$n]="${fields[$((i + 8))]}"
    WORKER_REPORTED_SIG[$n]="${fields[$((i + 9))]}"
    WORKER_FINISHING[$n]="${fields[$((i + 10))]}"
    i=$((i + 11))
  done
  log INFO "Adopted ${#WORKER_PIDS[@]} running worker(s): ${WORKER_ISSUES[*]:-}"
}

# ─── Reload ──────────────────────────────────────────────────────────────────

# Re-exec this script in place when its code on disk differs from what this
# process loaded. Called on every poll. With workers running it first writes
# the handoff; when the new code refuses it, the reload falls back to the drain:
# RELOAD_PENDING stops the spawn gate claiming, so the count can actually reach
# 0 (the loop refills a freed slot in the same poll, so under a busy queue
# "wait for idle" alone would wait forever), and the exec runs with no worker
# left to hand over. `--once` never reloads.
#
# Only code committed on main is loaded (code_is_committed_main), and only code
# that passes `bash -n`. Neither refusal blocks claims.
#
# exec keeps the PID, so orchestrator.pid, `wt stop`, the nohup redirections
# from cmd_start and the workers' parent stay valid; acquire_lock accepts its
# own PID. Bash does not run the EXIT trap on exec, so the lock and status file
# survive, and the one thing that would leak — SEEN_SKIPS_FILE, which the new
# image re-creates — is removed here first.
#
# Breaker state is CARRIED across, not a reason to skip the reload: skipping only
# while the breaker is engaged would still zero a counter sitting at 2, and a
# fault that fails every issue would then never trip it. So CONSECUTIVE_FAILURES
# and PAUSED_UNTIL travel in ORCHESTRATOR_RELOAD_* variables, with the other
# state a restart would lose and a reload should not: GATED_ISSUES and
# CAP_REQUEUED_ISSUES (they bound retry loops), the start time (`wt watch`'s run
# window) and the last behind-origin WARN. restore_reload_state reads them back.
reload_if_code_changed() {
  [ "$RUN_ONCE" = true ] && return 0
  [ "$SHUTTING_DOWN" = true ] && return 0
  [ -n "$CODE_FINGERPRINT" ] || return 0

  local new_fp=""
  new_fp=$(code_fingerprint) || new_fp=""
  if [ -z "$new_fp" ] || [ "$new_fp" = "$CODE_FINGERPRINT" ] \
     || [ "$new_fp" = "$RELOAD_REJECTED_FINGERPRINT" ]; then
    RELOAD_PENDING=false
    return 0
  fi

  # Not held for good: committing the same content later must still reload,
  # so this only rate-limits the log line.
  if ! code_is_committed_main; then
    RELOAD_PENDING=false
    if [ "$new_fp" != "$RELOAD_HELD_FINGERPRINT" ]; then
      RELOAD_HELD_FINGERPRINT="$new_fp"
      log INFO "Orchestrator code changed on disk but is not committed on main; not reloading it (loaded $CODE_FINGERPRINT, on disk $new_fp)"
    fi
    return 0
  fi

  # A reload that cannot start must not replace code that runs. One WARN per
  # rejected version; the next edit gets its own check.
  local f bad=""
  for f in "${ORCHESTRATOR_CODE_FILES[@]}"; do
    "$BASH" -n "$f" 2>/dev/null || bad+="${bad:+, }$(basename "$f")"
  done
  if [ -n "$bad" ]; then
    RELOAD_PENDING=false
    RELOAD_REJECTED_FINGERPRINT="$new_fp"
    log WARN "Orchestrator code changed on disk but fails bash -n ($bad); keeping the running code (loaded $CODE_FINGERPRINT, on disk $new_fp)"
    return 0
  fi

  # bash -n passing says nothing about a file that changed again while it ran
  # (a pull still writing). Wait for the next poll rather than exec a moving target.
  local settled_fp=""
  settled_fp=$(code_fingerprint) || settled_fp=""
  [ "$settled_fp" = "$new_fp" ] || return 0

  # The check at the top ran before the fingerprint and `bash -n` calls, and a
  # signal that lands during them only sets the flag. The new image starts with
  # it cleared, so exec'ing now would lose the signal (HON-1067).
  [ "$SHUTTING_DOWN" = true ] && return 0

  local handoff="" adopting=""
  if [ ${#WORKER_PIDS[@]} -gt 0 ]; then
    local reason=""
    if ! write_worker_handoff reason; then
      if [ "$RELOAD_PENDING" != true ]; then
        log INFO "Orchestrator code changed on disk ($CODE_FINGERPRINT -> $new_fp) but cannot hand over the running workers ($reason); claiming nothing new until ${#WORKER_PIDS[@]} running worker(s) finish, then reloading"
      fi
      RELOAD_PENDING=true
      return 0
    fi
    handoff="$RELOAD_WORKERS_FILE"
    adopting=", handing over ${#WORKER_PIDS[@]} running worker(s)"
  fi

  log INFO "Orchestrator code changed on disk ($CODE_FINGERPRINT -> $new_fp); reloading in place (PID $$)$adopting"

  export ORCHESTRATOR_RELOAD_FINGERPRINT="$CODE_FINGERPRINT"
  export ORCHESTRATOR_RELOAD_START_TIME="$ORCHESTRATOR_START_TIME"
  export ORCHESTRATOR_RELOAD_FAILURES="$CONSECUTIVE_FAILURES"
  export ORCHESTRATOR_RELOAD_PAUSED_UNTIL="$PAUSED_UNTIL"
  export ORCHESTRATOR_RELOAD_GATED="$GATED_ISSUES"
  export ORCHESTRATOR_RELOAD_CAP_REQUEUED="$CAP_REQUEUED_ISSUES"
  export ORCHESTRATOR_RELOAD_CHECKOUT_WARNED="$CHECKOUT_WARNED_SHA"
  [ -z "$handoff" ] || export ORCHESTRATOR_RELOAD_WORKERS_FILE="$handoff"
  export_deferred_state
  rm -f "$SEEN_SKIPS_FILE"

  # execfail: without it a failed exec kills a non-interactive shell outright,
  # which is the one outcome this function exists to rule out.
  local rc=0
  shopt -s execfail
  reload_exec "$BASH" "$SCRIPT_DIR/orchestrator.sh" ${ORCHESTRATOR_ARGS[@]+"${ORCHESTRATOR_ARGS[@]}"} || rc=$?
  shopt -u execfail

  # Only reached when the exec failed: carry on as the old image, which still
  # tracks its workers in memory.
  unset ORCHESTRATOR_RELOAD_FINGERPRINT ORCHESTRATOR_RELOAD_START_TIME ORCHESTRATOR_RELOAD_FAILURES \
    ORCHESTRATOR_RELOAD_PAUSED_UNTIL ORCHESTRATOR_RELOAD_GATED ORCHESTRATOR_RELOAD_CAP_REQUEUED \
    ORCHESTRATOR_RELOAD_CHECKOUT_WARNED ORCHESTRATOR_RELOAD_DEFERRED ORCHESTRATOR_RELOAD_NETWORK_RESPAWNED \
    ORCHESTRATOR_RELOAD_WORKERS_FILE
  [ -z "$handoff" ] || rm -f "$handoff"
  SEEN_SKIPS_FILE=$(mktemp "${TMPDIR:-/tmp}/orchestrator-skips.XXXXXXXX") || SEEN_SKIPS_FILE=/dev/null
  RELOAD_REJECTED_FINGERPRINT="$new_fp"
  RELOAD_PENDING=false
  log ERROR "Reload failed (exec exit $rc); keeping the running code until the next change on disk"
  return 0
}

# In an image started by reload_if_code_changed, take back the state the old
# image handed over, then drop the variables so no worker inherits them. A value
# that is not what the old image would have written is ignored, leaving the
# fresh-start default.
restore_reload_state() {
  [ -n "${ORCHESTRATOR_RELOAD_FINGERPRINT:-}" ] || return 0
  RELOADED=true

  local previous="$ORCHESTRATOR_RELOAD_FINGERPRINT"
  if [[ "${ORCHESTRATOR_RELOAD_FAILURES:-}" =~ ^[0-9]+$ ]]; then
    CONSECUTIVE_FAILURES="$ORCHESTRATOR_RELOAD_FAILURES"
  fi
  if [[ "${ORCHESTRATOR_RELOAD_PAUSED_UNTIL:-}" =~ ^[0-9]+$ ]]; then
    PAUSED_UNTIL="$ORCHESTRATOR_RELOAD_PAUSED_UNTIL"
  fi
  GATED_ISSUES="${ORCHESTRATOR_RELOAD_GATED:-}"
  CAP_REQUEUED_ISSUES="${ORCHESTRATOR_RELOAD_CAP_REQUEUED:-}"
  CHECKOUT_WARNED_SHA="${ORCHESTRATOR_RELOAD_CHECKOUT_WARNED:-}"
  ORCHESTRATOR_START_TIME="${ORCHESTRATOR_RELOAD_START_TIME:-}"
  restore_deferred_state

  unset ORCHESTRATOR_RELOAD_FINGERPRINT ORCHESTRATOR_RELOAD_START_TIME ORCHESTRATOR_RELOAD_FAILURES \
    ORCHESTRATOR_RELOAD_PAUSED_UNTIL ORCHESTRATOR_RELOAD_GATED ORCHESTRATOR_RELOAD_CAP_REQUEUED \
    ORCHESTRATOR_RELOAD_CHECKOUT_WARNED

  log INFO "Reloaded from $previous: circuit breaker failures=$CONSECUTIVE_FAILURES paused_until=$PAUSED_UNTIL, gated=[${GATED_ISSUES}] cap_requeued=[${CAP_REQUEUED_ISSUES}] deferred=${#DEFERRED[@]}"
  restore_worker_handoff
}

# Only reachable after a reload: on a first start validate_environment exits.
# Adopted workers go unmonitored while this waits; monitor_workers catches up
# on the first poll after it returns, timeouts included, because their start
# times came across.
wait_for_environment() {
  while true; do
    log WARN "Reloaded code failed environment validation; retrying in ${POLL_INTERVAL}s instead of exiting"
    interruptible_sleep "$POLL_INTERVAL"
    # With no worker, there is nothing to wait for or drain: a signal here ends
    # the run. With adopted workers, the main loop's shutdown path drains them.
    if [ "$SHUTTING_DOWN" = true ]; then
      [ ${#WORKER_PIDS[@]} -gt 0 ] && return 0
      log INFO "═══ Orchestrator stopped ═══"
      exit 0
    fi
    validate_environment && return 0
  done
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  if [ "${1:-}" = "--check-handoff" ] && [ -n "${2:-}" ]; then
    check_worker_handoff "$2"
    exit $?
  fi
  echo "Usage: $0 --check-handoff <file>  (otherwise sourced by orchestrator.sh)" >&2
  exit 64
fi
