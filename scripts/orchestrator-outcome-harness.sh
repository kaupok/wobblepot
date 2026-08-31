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
#     effect (CLEANUP / LABEL / RESTORE_TODO / COMMENT), so a test can assert
#     artifact retention, Linear bookkeeping and the operator-facing comment
#     text as well as the outcome label.
#
#   pr-for-branch <gh-json> | ci-state <gh-json>
#     Exercises the REAL helper against fixture JSON, with `gh` itself stubbed.
#     These cover the jq expression and the bucket classification — the parsing
#     the `outcome` mode stubs away.
#
#   sanitize <env-fixture-path> <text>            (HON-572, finding 1)
#     Points REPO_ROOT at the fixture's directory and runs the REAL sanitize_log
#     over <text>, so the .env-value redaction pass is under test with real
#     secret shapes (regex metacharacters, substrings, sub-8-char values).
#
#   failure <triage> <retried> <shutting_down> [repeat]   (HON-572, finding 2)
#     Drives the REAL handle_failure with spawn_worker / move_to_backlog /
#     cleanup_worker_worktree / linear_api / try_add_label / notify stubbed,
#     emitting one synthetic line per side effect. Triage is forced by putting a
#     `claude` stub first on PATH — the production call goes through
#     `env -u ANTHROPIC_API_KEY claude`, so a shell function would be bypassed,
#     and routing through PATH keeps the real verdict parsing under test.
#     `repeat` replays the SAME call N times in one process.
#     The worker log fed in carries real secret shapes, and the `claude` stub
#     records everything it receives (stdin + prompt args); the run emits a
#     TRIAGE_INPUT line so a test can assert the triage input is redacted by the
#     sanitize-at-capture pass (HON-577).
#     Ends with CONSECUTIVE_FAILURES / PAUSED / the write_status_file JSON.
#
#   bash-timeout <bound-secs> <command-sleep-secs>                  (HON-578)
#     Drives the REAL bash_timeout watchdog — the branch taken on a host with no
#     coreutils `timeout`, which is every stock macOS, the orchestrator included.
#     Prints OUT (the command's stdout, proving stdin survived backgrounding)
#     and EXIT (124 when the bound was hit).
#
#   failure-seq <triage:retried:shutting_down,...>        (HON-572, finding 2)
#     Same stubs, but replays a SEQUENCE of different failures in one process.
#     This is what models a systemic fault sweeping the queue: every issue fails
#     once at retried=0 and again at retried=1, so a breaker that resets on any
#     handle_failure branch oscillates instead of tripping. `repeat` cannot
#     express that — it only replays one identical call.
#
#   log-once                                       (HON-572, finding 3)
#     Calls the REAL log() once with MAIN_LOG on a temp file, then reports what
#     the file holds. stderr carries log()'s own colored copy, so a test that
#     captures the two streams separately can assert the file is written exactly
#     once and carries no ANSI escapes.
#
#   neon-gc-select <branches-json> <live-worktrees>  (HON-572, finding 4)
#     Sources worktree-claude.sh (guarded: sourcing does not run its dispatcher)
#     and runs the REAL neon_gc_orphan_names — the jq select expression plus the
#     live-worktree and is_protected_neon_branch filters — over fixture data.
#     NEON_USER_PREFIX is read from the environment.
#
#   stop-wait-bound <worker-count>                 (HON-572, finding 5)
#     Prints the REAL stop_wait_bound from worktree-claude.sh.
#
#   detect-phase <wt_path> <branch> <log-file>     (HON-576)
#     Runs the REAL detect_phase with get_worktree_path stubbed to <wt_path>,
#     so the git heuristics run against a fixture repo built in a temp dir.
#     Everything else is genuine: the marker grep, the auto-implement grep, the
#     pushed-branch predicate and the log fallback.
#
#   wt-detect-phase <log-file> <wt_path> <branch> <ahead> <dirty>   (HON-576)
#     Same question for the display path: sources worktree-claude.sh and runs
#     the REAL wt_detect_phase, which `wt status` and `wt watch` both call.
#     Its two call sites live inside interactive render loops, so this helper is
#     the only part of them a test can reach.
#
#   sync-permissions <main-repo-dir> <worktree-dir>                 (HON-579)
#     Runs orchestrator.sh's REAL sync_permissions with REPO_ROOT pointed at the
#     fixture main repo. Used to prove concurrent syncs never corrupt the shared
#     settings file — the mktemp temp-path fix.
#
#   worktree-path <branch> [worktree-base]                          (HON-579)
#     Sources worktree-claude.sh and prints get_worktree_path, optionally with
#     WORKTREE_BASE overridden to a fixture dir so the `--` mapping and the
#     legacy single-dash fallback are under test.
#
#   normalize-branch <branch>                                       (HON-579)
#     Sources worktree-claude.sh and prints the REAL normalize_branch.
#
#   todo-cap <count>                                                (HON-580)
#     Drives the REAL fetch_todo_issues with linear_api stubbed to return
#     exactly <count> nodes, so the cap check on what comes back is under test
#     without a Linear round trip. Prints NODES:<n> plus whatever landed in
#     $MAIN_LOG, which is where the cap WARN goes.
#
#   load-env <env-file>                                             (HON-580)
#     Sources worktree-claude.sh and runs the REAL load_env_file over a fixture
#     .env, then prints the HON580_* namespace, NUL-separated so a multi-line
#     value survives the trip. Only that namespace: a real value from the
#     developer's environment can never reach test output, and the fixture owns
#     the prefix.

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Capture every argument BEFORE clearing "$@": orchestrator.sh parses "$@" at
# top level, so a sourcing script's own positional parameters would otherwise be
# read as orchestrator flags.
MODE="${1:-}"; A1="${2:-}"; A2="${3:-}"; A3="${4:-}"; A4="${5:-}"; A5="${6:-}"
set --

# shellcheck source=./orchestrator.sh
source "$HARNESS_DIR/orchestrator.sh"

# orchestrator.sh sets `set -euo pipefail`. Only `-u` is relaxed: the harness
# reads orchestrator globals the poll loop would have initialised. `-e` STAYS ON
# — errexit is a dynamic option, so clearing it here would change how the sourced
# code under test behaves, and a statement that returns non-zero on a failure
# path would abort the real orchestrator mid-handle_success while passing
# silently here. That is exactly the defect ee9ad31 had to find by hand.
set +u

# Keep the harness out of the real ~/.worktrees/wobblepot/logs/orchestrator.log.
#
# orchestrator.sh installed `trap 'rm -f "$SEEN_SKIPS_FILE"' EXIT` at source
# time (line ~80). Bash keeps exactly one handler per signal, so this trap
# REPLACES that one — it has to repeat the cleanup or every harness invocation
# leaks an orchestrator-skips.* temp file (16 per `vitest run` of the suite).
MAIN_LOG=$(mktemp "${TMPDIR:-/tmp}/orchestrator-harness-log.XXXXXXXX")
trap 'rm -f "$MAIN_LOG" "$SEEN_SKIPS_FILE"' EXIT

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

    # Surface the comment body record_stranded / gate_no_commit_success posts,
    # so a test can assert on the operator-facing text — the PR-state wording and
    # the merge command are the parts that mislead a human when they are wrong.
    # Newlines are flattened: the log stays one line per side effect.
    linear_api() {
      local body=""
      body=$(printf '%s' "${2:-}" | jq -r '.body // empty' 2>/dev/null | tr '\n' ' ') || body=""
      [ -n "$body" ] && echo "COMMENT:$body" >> "$MAIN_LOG"
      echo '{"data":{}}'
    }
    notify() { :; }
    try_add_label() { echo "LABEL:$2" >> "$MAIN_LOG"; }
    restore_todo_if_in_progress() { echo "RESTORE_TODO:$2" >> "$MAIN_LOG"; }
    cleanup_worker_worktree() { echo "CLEANUP:${1}:${2:-false}" >> "$MAIN_LOG"; }

    # Print the captured log however handle_success ends. With errexit left on
    # (above), a stray non-zero statement aborts the script mid-function, and
    # the EXIT trap is then the only thing that still runs — so the assertions
    # see a truncated log and a non-zero exit rather than nothing at all.
    # `handle_success ... || true` would NOT work here: bash disables errexit
    # inside a function invoked as part of a `||` list, restoring precisely the
    # semantics this harness exists to stop hiding.
    # No explicit `exit` here: bash exits with the status that was in effect
    # before the trap ran, so an errexit abort still surfaces as a non-zero exit.
    trap 'cat "$MAIN_LOG"; rm -f "$MAIN_LOG" "$SEEN_SKIPS_FILE"' EXIT
    handle_success HON-999 uuid-999 test-branch /tmp/harness-worker.log 2>/dev/null
    exit 0
    ;;

  # ─── sanitize_log (HON-572 finding 1) ──────────────────────────────────────
  sanitize)
    # sanitize_log reads "$REPO_ROOT/.env"; point REPO_ROOT at the fixture's dir.
    ENV_FIXTURE="$A1"; TEXT="$A2"
    REPO_ROOT="$(cd "$(dirname "$ENV_FIXTURE")" && pwd)"
    sanitize_log "$TEXT"
    exit 0
    ;;

  # ─── handle_failure circuit breaker (HON-572 finding 2) ────────────────────
  failure | failure-seq)
    if [ "$MODE" = "failure" ]; then
      # One repeated call: "<triage>:<retried>:<shutting_down>" x REPEAT.
      REPEAT="${A4:-1}"
      SEQUENCE="$A1:$A2:$A3"
      n=1
      while [ "$n" -lt "$REPEAT" ]; do SEQUENCE="$SEQUENCE,$A1:$A2:$A3"; n=$((n + 1)); done
    else
      SEQUENCE="$A1"
    fi

    # Force each triage verdict via a PATH stub rather than a shell function:
    # handle_failure invokes `env -u ANTHROPIC_API_KEY claude`, which resolves
    # through PATH and would never see a function. This also leaves the real
    # exit-code handling and first-word parsing under test. The stub reads the
    # verdict from a file so the sequence can change it between calls.
    #
    # The stub also records everything the triage CLI receives — stdin (the log
    # tail) plus the prompt args (which carry the timeout context) — so a test
    # can assert the input is redacted (HON-577). It appends across calls, so a
    # leak on any step of a sequence still surfaces.
    #
    # HARNESS_CLAUDE_SLEEP (from the environment) makes it hang before it
    # answers, so a test can drive the triage timeout path with a short
    # ORCHESTRATOR_TRIAGE_TIMEOUT and assert the BACKLOG fallback (HON-578).
    # The sleep comes first, so a stub the bound kills records nothing — which
    # is what a genuinely wedged CLI does.
    STUB_BIN=$(mktemp -d "${TMPDIR:-/tmp}/orchestrator-harness-bin.XXXXXXXX")
    VERDICT_FILE="$STUB_BIN/verdict"
    TRIAGE_INPUT_FILE="$STUB_BIN/triage-input"
    : > "$TRIAGE_INPUT_FILE"
    # Unquoted heredoc: the two FILE paths bake in at write time, while `$*` and
    # $HARNESS_CLAUDE_SLEEP stay literal for the stub to resolve when it runs.
    cat > "$STUB_BIN/claude" <<EOF
#!/bin/sh
[ -n "\$HARNESS_CLAUDE_SLEEP" ] && sleep "\$HARNESS_CLAUDE_SLEEP"
cat >> "$TRIAGE_INPUT_FILE"
printf '%s' "\$*" >> "$TRIAGE_INPUT_FILE"
cat "$VERDICT_FILE"
EOF
    chmod +x "$STUB_BIN/claude"
    PATH="$STUB_BIN:$PATH"

    # A worker log carrying real secret shapes, so the sanitize-at-capture pass
    # in handle_failure is under test end to end: these must be redacted before
    # the log tail reaches the triage CLI.
    WORKER_LOG=$(mktemp "${TMPDIR:-/tmp}/orchestrator-harness-worklog.XXXXXXXX")
    {
      echo "Starting autonomous Claude Code"
      echo "----"
      echo "DATABASE_URL=postgresql://user:supersecretpw@db.example/app"
      echo "LINEAR_API_KEY=lin_api_SECRET1234567890abcdef"
    } > "$WORKER_LOG"

    # Keep write_status_file off the real ~/.worktrees status file.
    STATUS_FILE=$(mktemp "${TMPDIR:-/tmp}/orchestrator-harness-status.XXXXXXXX")
    trap 'cat "$MAIN_LOG"; rm -rf "$MAIN_LOG" "$SEEN_SKIPS_FILE" "$STATUS_FILE" "$STUB_BIN" "$WORKER_LOG"' EXIT

    DRY_RUN=false
    ORCHESTRATOR_START_TIME="1970-01-01T00:00:00Z"

    count_commits() { echo 0; }
    detect_phase() { echo "implementing"; }
    notify() { :; }
    linear_api() { echo '{"data":{}}'; }
    try_add_label() { echo "LABEL:$2" >> "$MAIN_LOG"; }
    cleanup_worker_worktree() { echo "CLEANUP:${1}:${2:-false}" >> "$MAIN_LOG"; }
    move_to_backlog() { echo "MOVE_TO_BACKLOG:${2}:${4}" >> "$MAIN_LOG"; }
    spawn_worker() { echo "SPAWN_WORKER:${2}:retry=${5:-0}" >> "$MAIN_LOG"; }

    STEP=0
    IFS=',' read -ra STEPS <<< "$SEQUENCE"
    for step in "${STEPS[@]}"; do
      STEP=$((STEP + 1))
      IFS=':' read -r s_triage s_retried s_shutdown <<< "$step"
      printf '%s\n' "$s_triage" > "$VERDICT_FILE"
      SHUTTING_DOWN="$s_shutdown"
      # A distinct issue id per step, so an assertion can tell the calls apart
      # the way a systemic fault walking the Todo queue would.
      handle_failure "HON-99$STEP" "uuid-99$STEP" "test-branch-$STEP" "$WORKER_LOG" \
        "$s_retried" failed "Fixture title" 2>/dev/null
    done

    # Flatten to one line: what the triage CLI actually received across all steps.
    echo "TRIAGE_INPUT:$(tr '\n' ' ' < "$TRIAGE_INPUT_FILE")" >> "$MAIN_LOG"
    echo "CONSECUTIVE_FAILURES:$CONSECUTIVE_FAILURES" >> "$MAIN_LOG"
    if [ "$PAUSED_UNTIL" -gt "$(date +%s)" ]; then
      echo "PAUSED:true" >> "$MAIN_LOG"
    else
      echo "PAUSED:false" >> "$MAIN_LOG"
    fi

    # The breaker value an operator (and `wt status`) actually reads.
    write_status_file
    echo "STATUS_JSON:$(jq -c '.circuit_breaker' "$STATUS_FILE")" >> "$MAIN_LOG"
    exit 0
    ;;

  # ─── log() writes $MAIN_LOG exactly once (HON-572 finding 3) ───────────────
  log-once)
    log INFO "harness-marker"
    # stdout only — stderr belongs to log() itself, and the test reads the two
    # streams separately to prove the file copy and the console copy are distinct.
    echo "FILE_LINES:$(wc -l < "$MAIN_LOG" | tr -d ' ')"
    echo "FILE_MARKERS:$(grep -c 'harness-marker' "$MAIN_LOG" | tr -d ' ')"
    echo "FILE_ESCAPES:$(grep -c "$(printf '\033')" "$MAIN_LOG" | tr -d ' ')"
    exit 0
    ;;

  # ─── Neon orphan GC selection (HON-572 finding 4) ──────────────────────────
  neon-gc-select)
    BRANCHES_JSON="$A1"; LIVE_WORKTREES="$A2"
    # Sourced, not executed: worktree-claude.sh returns early before its .env
    # load and command dispatcher when BASH_SOURCE[0] != $0. Done inside this
    # branch so the other modes keep orchestrator.sh's globals untouched.
    # shellcheck source=./worktree-claude.sh
    source "$HARNESS_DIR/worktree-claude.sh"
    neon_gc_orphan_names "$BRANCHES_JSON" "$LIVE_WORKTREES"
    exit 0
    ;;

  # ─── wt stop drain bound (HON-572 finding 5) ───────────────────────────────
  stop-wait-bound)
    # shellcheck source=./worktree-claude.sh
    source "$HARNESS_DIR/worktree-claude.sh"
    stop_wait_bound "$A1"
    exit 0
    ;;

  # ─── detect_phase git heuristics (HON-576) ─────────────────────────────────
  detect-phase)
    WT_PATH="$A1"; BRANCH="$A2"; LOG_FILE="$A3"
    # The only stub: detect_phase resolves the worktree through the real
    # ~/.worktrees layout, and the fixture lives in a temp dir.
    get_worktree_path() { echo "$WT_PATH"; }
    detect_phase "$LOG_FILE" "$BRANCH"
    exit 0
    ;;

  # ─── wt status / wt watch phase column (HON-576) ───────────────────────────
  wt-detect-phase)
    # Sourced, not executed — see neon-gc-select above for why that is safe.
    # shellcheck source=./worktree-claude.sh
    source "$HARNESS_DIR/worktree-claude.sh"
    wt_detect_phase "$A1" "$A2" "$A3" "$A4" "$A5"
    exit 0
    ;;

  # ─── Log rotation and pruning (HON-578) ────────────────────────────────────
  rotate-logs)
    # A1 = a temp log dir the test has pre-populated. Point LOG_DIR / MAIN_LOG
    # at it and run the REAL rotate_logs; the caps come from the environment
    # (ORCHESTRATOR_LOG_MAX_BYTES / ORCHESTRATOR_WORKER_LOG_MAX_AGE_DAYS), which
    # orchestrator.sh already read at source time.
    LOG_DIR="$A1"
    MAIN_LOG="$LOG_DIR/orchestrator.log"
    trap 'rm -f "$SEEN_SKIPS_FILE"' EXIT
    rotate_logs
    echo "MAIN_EXISTS:$([ -f "$MAIN_LOG" ] && echo yes || echo no)"
    echo "ROTATED_EXISTS:$([ -f "${MAIN_LOG}.1" ] && echo yes || echo no)"
    for f in "$LOG_DIR"/worker-*.log; do
      [ -e "$f" ] && echo "WORKER:$(basename "$f")"
    done
    exit 0
    ;;

  # ─── Pure-bash timeout fallback (HON-578) ──────────────────────────────────
  bash-timeout)
    # A1 = the bound, A2 = how long the command sleeps. Drives the REAL
    # coreutils-free watchdog directly, so Linux CI — which HAS GNU timeout and
    # would always take the first branch — still covers the branch macOS always
    # takes. The command reads stdin before sleeping, so OUT also proves the
    # async job kept the caller's pipe instead of bash's /dev/null default.
    #
    # `|| status=$?` rather than `set +e`: errexit is dynamic, and clearing it
    # would change the code under test.
    status=0
    out=$(echo "piped-stdin" | bash_timeout "$A1" \
      sh -c 'read -r line; sleep "$0"; printf "%s\n" "$line"' "$A2") || status=$?
    echo "OUT:$out"
    echo "EXIT:$status"
    exit 0
    ;;

  # ─── Workflow-state UUID validation (HON-578) ──────────────────────────────
  validate-states)
    # A1 = the workflowStates JSON Linear would return. Runs the REAL
    # validate_state_ids against it; no network. The stale count lands on
    # stdout, and the ERROR lines log() wrote land in $MAIN_LOG, so both are
    # asserted from one run.
    trap 'rm -f "$MAIN_LOG" "$SEEN_SKIPS_FILE"' EXIT
    STALE_COUNT=$(validate_state_ids "$A1")
    echo "STALE_COUNT:$STALE_COUNT"
    cat "$MAIN_LOG"
    exit 0
    ;;

  # ─── sync_permissions temp-file race (HON-579) ─────────────────────────────
  sync-permissions)
    # Runs orchestrator.sh's sync_permissions (already sourced above). It reads
    # the main settings from "$REPO_ROOT/.claude/settings.local.json".
    REPO_ROOT="$A1"
    sync_permissions "$A2"
    exit 0
    ;;

  # ─── worktree path derivation (HON-579) ────────────────────────────────────
  worktree-path)
    # shellcheck source=./worktree-claude.sh
    source "$HARNESS_DIR/worktree-claude.sh"
    [ -n "$A2" ] && WORKTREE_BASE="$A2"
    get_worktree_path "$A1"
    exit 0
    ;;

  normalize-branch)
    # shellcheck source=./worktree-claude.sh
    source "$HARNESS_DIR/worktree-claude.sh"
    normalize_branch "$A1"
    exit 0
    ;;

  # ─── Todo queue cap warning (HON-580 finding 1) ────────────────────────────
  todo-cap)
    # The GraphQL round trip is not what is under test — the cap check on the
    # response is. Stub linear_api with exactly A1 synthetic nodes.
    linear_api() {
      jq -nc --argjson n "$A1" \
        '{data: {issues: {nodes: [range($n) | {identifier: ("HON-" + (. | tostring))}]}}}'
    }
    trap 'rm -f "$MAIN_LOG" "$SEEN_SKIPS_FILE"' EXIT
    # Proves the WARN did not contaminate the JSON the caller parses: log()
    # writes stderr and $MAIN_LOG, never stdout.
    echo "NODES:$(fetch_todo_issues | jq '.data.issues.nodes | length')"
    cat "$MAIN_LOG"
    exit 0
    ;;

  # ─── .env parsing (HON-580 finding 5) ──────────────────────────────────────
  load-env)
    # Sourced, not executed — see neon-gc-select above for why that is safe.
    # Crucially, the guard returns BEFORE worktree-claude.sh's own .env load, so
    # the only file this mode reads is the fixture.
    # shellcheck source=./worktree-claude.sh
    source "$HARNESS_DIR/worktree-claude.sh"
    load_env_file "$A1"
    # The fixture owns the HON580_ prefix; nothing else is printed. NUL-separated
    # rather than line-oriented, because `env | grep` prints only the line that
    # matched — it would drop the tail of a multi-line value and make a
    # truncating parser look correct, which is one of the things this mode exists
    # to catch.
    env -0 | while IFS= read -r -d '' entry; do
      case "$entry" in HON580_*) printf '%s\0' "$entry" ;; esac
    done
    exit 0
    ;;

  *)
    echo "Unknown harness mode: $MODE" >&2
    exit 64
    ;;
esac
