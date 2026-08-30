#!/bin/bash
# Test harness for orchestrator.sh outcome classification (HON-573).
#
# Sources orchestrator.sh — which defines functions without starting the poll
# loop when sourced — and replaces the collaborators that would touch the
# network, GitHub or Linear, so each branch can be driven deterministically.
# Driven by scripts/orchestrator.test.ts.
#
# Modes:
#   outcome <commits> <phase> <pr_state> <ci_state>
#     Drives handle_success with pr_for_branch / pr_ci_state stubbed.
#     pr_state ∈ OPEN | MERGED | CLOSED | NONE, where NONE models both "no PR
#     was ever opened" and "gh is missing or unauthenticated" — pr_for_branch
#     is silent in all three cases.
#     Prints the orchestrator's log lines, plus one synthetic line per side
#     effect (CLEANUP / LABEL / RESTORE_TODO), so a test can assert artifact
#     retention and Linear bookkeeping as well as the outcome label.
#
#   pr-for-branch <gh-json> | ci-state <gh-json>
#     Exercises the REAL helper against fixture JSON, with `gh` itself stubbed.
#     These cover the jq expression and the bucket classification — the parsing
#     the `outcome` mode stubs away.

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Capture every argument BEFORE clearing "$@": orchestrator.sh parses "$@" at
# top level, so a sourcing script's own positional parameters would otherwise be
# read as orchestrator flags.
MODE="${1:-}"; A1="${2:-}"; A2="${3:-}"; A3="${4:-}"; A4="${5:-}"
set --

# shellcheck source=./orchestrator.sh
source "$HARNESS_DIR/orchestrator.sh"

# orchestrator.sh sets `set -euo pipefail`; the harness drives failure paths on
# purpose, so an unset var or a non-zero probe must not abort the run.
set +eu

# Keep the harness out of the real ~/.worktrees/wobblepot/logs/orchestrator.log.
MAIN_LOG=$(mktemp "${TMPDIR:-/tmp}/orchestrator-harness-log.XXXXXXXX")
trap 'rm -f "$MAIN_LOG"' EXIT

case "$MODE" in
  # ─── Real helper, stubbed gh ───────────────────────────────────────────────
  pr-for-branch | ci-state)
    GH_FIXTURE="$A1"

    # Stand in for `gh … --json … --jq …`: apply the caller's own jq expression
    # to the fixture, exactly as gh would. This is what makes the helper's jq
    # expression the thing under test.
    gh() {
      local jq_expr=""
      while [ $# -gt 0 ]; do
        [ "$1" = "--jq" ] && jq_expr="$2"
        shift
      done
      if [ -n "$jq_expr" ]; then
        printf '%s' "$GH_FIXTURE" | jq -r "$jq_expr"
      else
        printf '%s' "$GH_FIXTURE"
      fi
    }

    if [ "$MODE" = "pr-for-branch" ]; then
      pr_for_branch test-branch
    else
      pr_ci_state 650
    fi
    exit 0
    ;;

  # ─── handle_success classification ─────────────────────────────────────────
  outcome)
    COMMITS="$A1"; PHASE="$A2"; PR_STATE="$A3"; CI_STATE="$A4"

    count_commits() { echo "$COMMITS"; }
    detect_phase() { echo "$PHASE"; }
    pr_ci_state() { echo "$CI_STATE"; }

    pr_for_branch() {
      [ "$PR_STATE" = "NONE" ] && return 0
      printf '%s\t%s\t%s\n' "$PR_STATE" "650" "https://github.com/kaupok/honkadori/pull/650"
    }

    linear_api() { echo '{"data":{}}'; }
    notify() { :; }
    try_add_label() { echo "LABEL:$2" >> "$MAIN_LOG"; }
    restore_todo_if_in_progress() { echo "RESTORE_TODO:$2" >> "$MAIN_LOG"; }
    cleanup_worker_worktree() { echo "CLEANUP:${1}:${2:-false}" >> "$MAIN_LOG"; }

    handle_success HON-999 uuid-999 test-branch /tmp/harness-worker.log 2>/dev/null

    cat "$MAIN_LOG"
    exit 0
    ;;

  *)
    echo "Unknown harness mode: $MODE" >&2
    exit 64
    ;;
esac
