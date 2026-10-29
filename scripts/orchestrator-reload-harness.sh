#!/bin/bash
# Test harness for the reload's worker handoff in orchestrator-reload.sh
# (HON-1457). Driven by scripts/orchestrator.reload.test.ts.
# orchestrator-outcome-harness.sh is near its size cap, so these modes live here.
#
# Modes:
#   reload <scenario> <dir>
#     The old image. Starts three workers through the REAL spawn_worker against
#     a stub worktree-claude.sh, commits a change to a fixture code file, then
#     runs the REAL reload_if_code_changed. reload_exec prints EXEC, the
#     ORCHESTRATOR_RELOAD_WORKERS_FILE it hands over and the handoff JSON, then
#     performs a REAL exec into `adopted <scenario> <dir>`.
#     Scenarios: exits, timeout, stop, budget (each execs); version, where the
#     handoff says version 99: the new code refuses it, so the poll prints
#     PENDING and HANDOFF_FILE, the workers finish, and a second poll execs
#     with nothing to hand over; and stop-mid, where a SIGTERM lands while the
#     handoff is written: no exec, and the old image keeps its workers.
#
#   adopted <scenario> <dir>
#     The new image. Runs the REAL restore_reload_state, prints the rebuilt
#     arrays (ARR:<i>:<fields>), the status file's workers and the REAL
#     `wt status` rows, then:
#       exits    HON-1 exits 0, HON-2 exits 3, HON-3's wrapper is killed before
#                it writes its exit file. The REAL monitor_workers polls until
#                no worker is left; the handlers are stubbed to print HANDLER
#                lines, then ZOMBIES counts adopted PIDs left as zombies.
#                Also spawns HON-4 alongside the adopted three.
#       timeout  monitor_workers once; HON-1 started past WORKER_TIMEOUT. Then
#                releases the other two and waits for them.
#       budget   The REAL exit_unless_adopted, as main calls it when the
#                branch budget refuses the new code: SHUTTING_DOWN, no exit.
#       stop     Takes `wt stop`'s snapshot of the status file, as cmd_stop
#                does before its first signal. The REAL shutdown handler takes
#                one SIGTERM, HON-1 exits 0 and is handled, then a second
#                SIGTERM and the REAL drain_if_forced drains the rest (exit 1).
#                ORPHANS_BEFORE / ORPHANS_AFTER are the issues `wt stop`'s REAL
#                stop_drain_orphans reports as still running before the force
#                drain and after it.
#
# <dir> is a scratch dir the test creates and removes. Each stub worker waits
# for <dir>/release-<issue>, then exits with the code written there.

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-}"; SCENARIO="${2:-}"; DIR="${3:-}"
set --

# shellcheck source=./orchestrator.sh
source "$HARNESS_DIR/orchestrator.sh"
set +u

MAIN_LOG="$DIR/main.log"
trap 'rm -f "$SEEN_SKIPS_FILE"' EXIT
SCRIPT_DIR="$DIR/scripts"
LOG_DIR="$DIR/logs"
WORKTREE_BASE="$DIR/home/.worktrees/wobblepot"
STATUS_FILE="$WORKTREE_BASE/orchestrator-status.json"
RELOAD_WORKERS_FILE="$WORKTREE_BASE/orchestrator-reload-workers.json"
DRY_RUN=false

# The stubs every handler path reaches. They print instead of acting.
handle_success() { echo "HANDLER:success:$1:$5" >> "$MAIN_LOG"; }
handle_error_exit() { echo "HANDLER:error:$1:$7" >> "$MAIN_LOG"; }
handle_timeout() { echo "HANDLER:timeout:$1:$7" >> "$MAIN_LOG"; }
check_lost_branch() { :; }
cleanup_worker_worktree() { echo "CLEANUP:$1:$2" >> "$MAIN_LOG"; }
restore_queue_if_in_progress() { echo "RESTORE_QUEUED:$2" >> "$MAIN_LOG"; }
drain_finish_attempt() { echo "DRAIN_FINISH:$1" >> "$MAIN_LOG"; return 0; }
settle_deferred_at_exit() { :; }

release() { echo "$2" > "$DIR/release-$1"; }

# Poll monitor_workers until no worker is left, at most $1 half-second rounds.
# A zombie reads as alive to `kill -0`, so an unreaped worker never leaves.
monitor_until_empty() {
  local rounds=0
  while [ ${#WORKER_PIDS[@]} -gt 0 ] && [ "$rounds" -lt "$1" ]; do
    monitor_workers
    [ ${#WORKER_PIDS[@]} -gt 0 ] && sleep 0.5
    rounds=$((rounds + 1))
  done
  echo "LEFT:${#WORKER_PIDS[@]}"
}

case "$MODE" in
  reload)
    mkdir -p "$SCRIPT_DIR" "$LOG_DIR" "$WORKTREE_BASE" "$DIR/code"
    : > "$MAIN_LOG"
    # The check the old image runs on the new code is the real lib.
    ln -s "$HARNESS_DIR/orchestrator-reload.sh" "$SCRIPT_DIR/orchestrator-reload.sh"
    cat > "$SCRIPT_DIR/worktree-claude.sh" <<EOF
#!/bin/sh
echo "[plan-issue:complete]"
while [ ! -f "$DIR/release-\$2" ]; do sleep 0.1; done
exit "\$(cat "$DIR/release-\$2")"
EOF
    chmod +x "$SCRIPT_DIR/worktree-claude.sh"

    fixture_git() {
      git -C "$DIR/code" -c user.name=harness -c user.email=harness@example.test \
        -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@" >/dev/null 2>&1
    }
    git init -q -b main "$DIR/code" >/dev/null 2>&1
    printf '#!/bin/bash\necho v1\n' > "$DIR/code/code.sh"
    fixture_git add code.sh
    fixture_git commit -qm v1
    ORCHESTRATOR_CODE_FILES=("$DIR/code/code.sh")
    CODE_FINGERPRINT=$(code_fingerprint)
    ORCHESTRATOR_START_TIME="2026-10-29T08:00:00Z"

    spawn_worker uuid-1 HON-1 "" "First"$'\t'"title"
    spawn_worker uuid-2 HON-2 "" "Second" 1 "" 1
    spawn_worker uuid-3 HON-3 "" "Third"
    # A start time an hour back, so `wt status` and the timeout read it.
    WORKER_START_TIMES[0]=$(( $(date +%s) - 3600 ))
    [ "$SCENARIO" = timeout ] && WORKER_START_TIMES[0]=$(( $(date +%s) - WORKER_TIMEOUT - 1 ))
    WORKER_REPORTED_AT[1]=1790000000
    WORKER_REPORTED_SIG[1]="Implementing|2"
    [ "$SCENARIO" = version ] && RELOAD_HANDOFF_VERSION=99
    if [ "$SCENARIO" = stop-mid ]; then
      eval "real_$(declare -f write_worker_handoff)"
      write_worker_handoff() {
        local rc=0
        real_write_worker_handoff "$@" || rc=$?
        kill -TERM $$
        return $rc
      }
    fi

    reload_exec() {
      echo "EXEC"
      echo "WORKERS_FILE_ENV:${ORCHESTRATOR_RELOAD_WORKERS_FILE:-none}"
      [ -f "$RELOAD_WORKERS_FILE" ] && echo "HANDOFF:$(jq -c . "$RELOAD_WORKERS_FILE")"
      cat "$MAIN_LOG"; : > "$MAIN_LOG"
      [ "$SCENARIO" = version ] && exit 0
      exec "$BASH" "$HARNESS_DIR/orchestrator-reload-harness.sh" adopted "$SCENARIO" "$DIR"
    }

    printf '\necho v2\n' >> "$DIR/code/code.sh"
    fixture_git commit -qam change
    reload_if_code_changed
    # Only version and stop-mid get here: no exec on this poll.
    echo "PENDING:$RELOAD_PENDING"
    echo "WORKERS:${#WORKER_PIDS[@]}"
    echo "HANDOFF_FILE:$([ -e "$RELOAD_WORKERS_FILE" ] && echo present || echo gone)"
    release HON-1 0; release HON-2 0; release HON-3 0
    monitor_until_empty 20
    reload_if_code_changed
    echo "NO_EXEC"
    cat "$MAIN_LOG"
    ;;

  adopted)
    echo "PID:$$"
    restore_reload_state
    echo "RELOADED:$RELOADED"
    echo "PENDING:$RELOAD_PENDING"
    echo "HANDOFF_FILE:$([ -e "$RELOAD_WORKERS_FILE" ] && echo present || echo gone)"
    i=0
    while [ $i -lt ${#WORKER_PIDS[@]} ]; do
      echo "ARR:$i:${WORKER_PIDS[$i]}|${WORKER_ISSUES[$i]}|${WORKER_ISSUE_UUIDS[$i]}|${WORKER_BRANCHES[$i]}|$(basename "${WORKER_LOGS[$i]}")|${WORKER_START_TIMES[$i]}|${WORKER_RETRIED[$i]}|${WORKER_TITLES[$i]}|${WORKER_REPORTED_AT[$i]}|${WORKER_REPORTED_SIG[$i]}|${WORKER_FINISHING[$i]}"
      i=$((i + 1))
    done
    write_status_file
    echo "STATUS:$(jq -c '[.workers[] | {issue, pid, started_at, log: (.log_file | split("/") | last)}]' "$STATUS_FILE")"
    HOME="$DIR/home" "$BASH" "$HARNESS_DIR/worktree-claude.sh" status 2>&1 \
      | sed $'s/\x1b\\[[0-9;]*m//g' | grep -E '^ +HON-' | sed 's/^ */WT_STATUS:/'

    case "$SCENARIO" in
      exits)
        spawn_worker uuid-4 HON-4 "" "Fourth"
        echo "COUNT_AFTER_SPAWN:${#WORKER_PIDS[@]}"
        release HON-1 0; release HON-2 3
        # The wrapper dies before it can write HON-3's exit file.
        kill -KILL "${WORKER_PIDS[2]}"; release HON-3 0; release HON-4 0
        adopted_pids="${WORKER_PIDS[*]:0:3}"
        monitor_until_empty 20
        # Bash reaps an exited child it did not start; a zombie would show Z.
        echo "ZOMBIES:$(ps -o stat= -p "${adopted_pids// /,}" 2>/dev/null | grep -c Z || true)"
        ;;
      budget)
        exit_unless_adopted "The branch budget refused the reloaded code"
        echo "SHUTTING_DOWN:$SHUTTING_DOWN"
        release HON-1 0; release HON-2 0; release HON-3 0
        monitor_until_empty 20
        ;;
      timeout)
        monitor_workers
        echo "LEFT:${#WORKER_PIDS[@]}"
        # Wait for HON-2 and HON-3, or their stubs outlive the harness (HON-1460).
        # Their exits are not under test, so their handler lines are dropped.
        release HON-1 0; release HON-2 0; release HON-3 0
        MAIN_LOG=/dev/null monitor_until_empty 20 > /dev/null
        ;;
      stop)
        snapshot=$(bash -c 'source "$1"; stop_drain_snapshot "$2"' _ "$HARNESS_DIR/wt-stop-check.sh" "$STATUS_FILE")
        orphans() {
          bash -c 'source "$1"; stop_drain_orphans "$2"' _ "$HARNESS_DIR/wt-stop-check.sh" "$snapshot" \
            | cut -f1 | tr '\n' ' '
        }
        kill -TERM $$
        echo "SHUTTING_DOWN:$SHUTTING_DOWN FORCE:$FORCE_SHUTDOWN"
        release HON-1 0
        sleep 0.5
        monitor_workers
        echo "LEFT:${#WORKER_PIDS[@]}"
        echo "ORPHANS_BEFORE:$(orphans)"
        kill -TERM $$
        echo "SHUTTING_DOWN:$SHUTTING_DOWN FORCE:$FORCE_SHUTDOWN"
        trap 'echo "ORPHANS_AFTER:$(orphans)"; cat "$MAIN_LOG"; rm -f "$SEEN_SKIPS_FILE"' EXIT
        drain_if_forced
        ;;
    esac
    cat "$MAIN_LOG"
    ;;

  *)
    echo "Unknown harness mode: $MODE" >&2
    exit 64
    ;;
esac
