#!/usr/bin/env bash
# The review server for one issue, in three commands. `/implement-issue` →
# "Drive changed screens" used to spell this out as 40 lines of shell that each
# run copied by hand; the mechanics live here now, so the skill states the goal.
#
#   bash scripts/review-serve.sh start HON-XX [--seed]   # run in the background
#   bash scripts/review-serve.sh wait HON-XX             # foreground, under 540 s
#   bash scripts/review-serve.sh stop HON-XX
#
# start: picks the database mode and a free port, records its own pid, and
#   execs `scripts/e2e-local.sh serve` with its output in the log. It runs
#   until stopped, so the caller backgrounds it with a long timeout: the
#   10-minute background default would kill the server partway through the
#   screens, and a killed server leaves its Neon branch behind
#   (`pnpm test:e2e:local gc` sweeps it).
#   - Database mode: `--db env` when this checkout's .env has its own
#     DATABASE_URL (`wt new`, `wt auto`), so it spends no second Neon branch;
#     otherwise branch mode. `--seed` is passed through in either mode; a bare
#     `pnpm db:seed` can seed another database than the server reads (HON-1272).
#   - Port: a random free one in 3201–3299, because up to five workers run at
#     once and `pnpm dev` holds 3000.
# wait: prints the server's `REVIEW-READY <url>` line and exits 0 once it
#   answers; `REVIEW_FAILED` with the log tail (no Neon slot, no key, a refused
#   .env) and exits 1; `REVIEW_WAITING` after REVIEW_SERVE_WAIT_SECS (480,
#   under the 540 s foreground cap) so the caller runs it again. READY counts
#   only if the server is still alive 5 s later: when another server took the
#   port, ours exits and the READY line was theirs.
# stop: TERMs the `start` process. Its exit trap stops the dev server and, in
#   branch mode, deletes the Neon branch. The pid file holds the script's own
#   pid, so this stops this issue's server and no other.
#
# Files: $REVIEW_SERVE_DIR/review-<id>.pid and .log (default /tmp).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

STATE_DIR="${REVIEW_SERVE_DIR:-/tmp}"
WAIT_SECS="${REVIEW_SERVE_WAIT_SECS:-480}"
POLL_SECS="${REVIEW_SERVE_POLL_SECS:-5}"
# Seconds READY must outlive before it counts as ours (see `wait` above).
SETTLE_SECS="${REVIEW_SERVE_SETTLE_SECS:-5}"

usage() {
  echo "usage: bash scripts/review-serve.sh <start|wait|stop> HON-XX [--seed]" >&2
  exit 2
}

cmd="${1:-}"; id="${2:-}"
[ -n "$cmd" ] && [ -n "$id" ] || usage
case "$id" in *[!A-Za-z0-9-]*) usage ;; esac
id="$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]')"
PID_FILE="$STATE_DIR/review-$id.pid"
LOG_FILE="$STATE_DIR/review-$id.log"

alive() { [ -s "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

db_mode_args() {
  local mine main main_env
  mine="$(grep '^DATABASE_URL=' .env 2>/dev/null || true)"
  main_env="$(git rev-parse --git-common-dir)/../.env"
  main="$(grep '^DATABASE_URL=' "$main_env" 2>/dev/null || true)"
  if [ -n "$mine" ] && [ "$mine" != "$main" ]; then
    echo "own database: --db env" >&2
    printf -- '--db env'
  else
    echo "shared database: branch mode" >&2
  fi
}

free_port() {
  local p
  for p in $(seq 3201 3299 | sort -R); do
    curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$p/" || { echo "$p"; return 0; }
  done
  echo "no free port in 3201-3299" >&2
  return 1
}

cmd_start() {
  local seed=() db
  for arg in "$@"; do
    case "$arg" in
      --seed) seed=(--seed) ;;
      *) echo "start: unknown argument '$arg'" >&2; usage ;;
    esac
  done
  if alive; then
    echo "a review server for $id is already running (pid $(cat "$PID_FILE")); stop it first" >&2
    exit 1
  fi
  # Before any probe, so a `wait` that overlaps this start never reads the
  # previous run's READY line.
  rm -f "$PID_FILE" "$LOG_FILE"
  db="$(db_mode_args)"
  REVIEW_LOCAL_PORT="$(free_port)"
  export REVIEW_LOCAL_PORT
  echo $$ > "$PID_FILE"
  # $db is zero or two words on purpose; the seed expansion survives an empty
  # array under `set -u` on the bash 3.2 macOS ships.
  # shellcheck disable=SC2086
  exec bash "$SCRIPT_DIR/e2e-local.sh" serve $db ${seed[@]+"${seed[@]}"} > "$LOG_FILE" 2>&1
}

fail_with_log() {
  tail -20 "$LOG_FILE" 2>/dev/null || true
  echo REVIEW_FAILED
  exit 1
}

cmd_wait() {
  local deadline=$((SECONDS + WAIT_SECS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if grep -q REVIEW-READY "$LOG_FILE" 2>/dev/null; then
      sleep "$SETTLE_SECS"
      alive && { grep REVIEW-READY "$LOG_FILE"; exit 0; }
      fail_with_log
    fi
    [ -s "$PID_FILE" ] && ! alive && fail_with_log
    sleep "$POLL_SECS"
  done
  echo REVIEW_WAITING
}

cmd_stop() {
  local pid i
  [ -s "$PID_FILE" ] || { echo "no review server recorded for $id" >&2; exit 0; }
  pid="$(cat "$PID_FILE")"
  kill -TERM "$pid" 2>/dev/null || true
  for i in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  rm -f "$PID_FILE" "$LOG_FILE"
  echo "review server for $id stopped"
}

case "$cmd" in
  start) shift 2; cmd_start "$@" ;;
  wait)  cmd_wait ;;
  stop)  cmd_stop ;;
  *)     usage ;;
esac
