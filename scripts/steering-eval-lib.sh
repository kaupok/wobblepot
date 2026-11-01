# shellcheck shell=bash
# Helpers for scripts/steering-eval.sh (HON-1345). Sourced, never executed.
# The caller sets REPO_ROOT and sources models.sh first. docs/STEERING_EVAL.md
# explains the method.

# Files that describe the eval. They quote every rule under test, so a run tree
# that kept them would show the agent both the rule and the experiment.
SE_EVAL_FILES=(scripts/steering-eval scripts/steering-eval.sh scripts/steering-eval-lib.sh
  scripts/steering-eval.test.ts docs/STEERING_EVAL.md)

# Doc sections that name the eval or quote a rule it verified, as "file|heading".
# The run tree keeps the doc and loses the section.
SE_EVAL_SECTIONS=("docs/AGENT_HISTORY.md|## Verified by the steering eval"
  "docs/PARALLEL_WORKFLOW.md|### Prune the guidance")

# Run "$@" with a bound of $1 seconds. A hit bound exits 124 (timeout) or 142
# (perl's SIGALRM). macOS has neither `timeout` nor `gtimeout` by default.
se_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$secs" "$@"
  fi
}

# Remove every occurrence of the text $2 from the file $1, then collapse the
# blank lines it leaves. Fails when the text is absent: a rule edited on main
# would otherwise give a control run that still holds the rule.
se_remove_text() {
  node -e '
    const fs = require("fs")
    const [file, text] = process.argv.slice(1)
    const before = fs.readFileSync(file, "utf8")
    if (!before.includes(text)) { console.error(`rule text not found in ${file}`); process.exit(3) }
    fs.writeFileSync(file, before.split(text).join("").replace(/\n{3,}/g, "\n\n"))
  ' "$1" "$2"
}

# Remove from the file $1 the section under the heading line $2, up to the next
# heading of the same or a higher level. A missing file or heading is a no-op.
se_strip_section() {
  [ -f "$1" ] || return 0
  node -e '
    const fs = require("fs")
    const [file, heading] = process.argv.slice(1)
    const level = heading.match(/^#+/)[0].length
    const lines = fs.readFileSync(file, "utf8").split("\n")
    const start = lines.indexOf(heading)
    if (start === -1) process.exit(0)
    let end = start + 1
    while (end < lines.length && !new RegExp(`^#{1,${level}} `).test(lines[end])) end++
    lines.splice(start, end - start)
    fs.writeFileSync(file, lines.join("\n"))
  ' "$1" "$2"
}

# Build a run tree at $3 for the rule JSON $1 and the arm $2 (control|treatment):
# `git archive` of STEERING_EVAL_REF into $3/repo, with the eval's own files
# removed and, for control, the rule text removed; one commit; then a worktree
# at $3/wt. The single commit hides the rule from `git log`, the tree has no
# remote to push to, and the worktree form passes the main-checkout hook.
se_prepare_tree() {
  local rule="$1" arm="$2" dest="$3" ref="${STEERING_EVAL_REF:-HEAD}" i count file text entry
  mkdir -p "$dest/repo" || return 1
  git -C "$REPO_ROOT" archive "$ref" | tar -x -C "$dest/repo" || return 1
  for file in "${SE_EVAL_FILES[@]}"; do rm -rf "${dest:?}/repo/$file"; done
  for entry in "${SE_EVAL_SECTIONS[@]}"; do
    se_strip_section "$dest/repo/${entry%%|*}" "${entry#*|}" || return 1
  done
  if [ "$arm" = control ]; then
    count=$(jq '.remove | length' "$rule") || return 1
    for ((i = 0; i < count; i++)); do
      file=$(jq -r ".remove[$i].file" "$rule")
      text=$(jq -r ".remove[$i].text" "$rule")
      se_remove_text "$dest/repo/$file" "$text" || return 1
    done
  fi
  (
    cd "$dest/repo" &&
      git init -q -b main &&
      git add -A &&
      GIT_AUTHOR_NAME=dev GIT_AUTHOR_EMAIL=dev@example.com \
        GIT_COMMITTER_NAME=dev GIT_COMMITTER_EMAIL=dev@example.com \
        git commit -q -m "Initial commit" &&
      git worktree add -q -b feature "$dest/wt"
  ) || return 1
  if [ -d "$REPO_ROOT/node_modules" ]; then ln -s "$REPO_ROOT/node_modules" "$dest/wt/node_modules"; fi
}

# Launch one blind session in the directory $1 on the model $2 at the effort $3
# with the prompt $4, writing stream-json to $5. No MCP server, so a run cannot
# reach Linear or GitHub. Returns claude's exit code, or 124/142 on a timeout.
se_launch() {
  local dir="$1" model="$2" effort="$3" prompt="$4" stream="$5"
  claude_model_args "$model" "$effort"
  claude_mcp_args
  (cd "$dir" && se_with_timeout "${STEERING_EVAL_TIMEOUT:-3600}" \
    env -u ANTHROPIC_API_KEY -u ORCHESTRATOR_RETRY_CONTEXT -u CLAUDE_PROJECT_DIR -u CLAUDECODE \
    claude -p --dangerously-skip-permissions --output-format stream-json --verbose \
    "${CLAUDE_MODEL_ARGS[@]}" "${CLAUDE_MCP_ARGS[@]}" -- "$prompt") >"$stream" 2>"${stream%.jsonl}.stderr"
}

# True when the stream-json at $1 holds a successful `result` event. A killed
# process can leave a cut-off last line, so lines that do not parse are skipped.
se_finished() {
  jq -R 'fromjson? | select(.type == "result" and .is_error == false)' "$1" 2>/dev/null | grep -q .
}

# Everything the run changed since the tree's one commit, its own commits included.
se_diff() {
  local wt="$1" base
  base=$(git -C "$wt" rev-list --max-parents=0 HEAD) || return 1
  git -C "$wt" add -A && git -C "$wt" diff --cached "$base"
}

# One run: rule JSON $1, arm $2, model $3, effort $4, run directory $5. Writes
# `pass`, `fail` or `error` to $5/result and the reason for an error to $5/reason.
se_run_one() {
  local rule="$1" arm="$2" model="$3" effort="$4" run="$5" result=error reason="" rc out check prompt
  mkdir -p "$run"
  prompt=$(jq -r .prompt "$rule")
  check=$(jq -r .check "$rule")
  if ! se_prepare_tree "$rule" "$arm" "$run" >"$run/prepare.log" 2>&1; then
    reason="prepare failed (prepare.log)"
  else
    se_launch "$run/wt" "$model" "$effort" "$prompt" "$run/stream.jsonl"
    rc=$?
    # A session that printed its result is done, even when the process lingered
    # on a child the agent started (a dev server, a watcher) until the bound.
    if [ "$rc" -ne 0 ] && se_finished "$run/stream.jsonl"; then rc=0; fi
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 142 ]; then
      reason=timeout
    elif [ "$rc" -ne 0 ]; then
      reason="claude exit $rc"
    elif ! se_diff "$run/wt" >"$run/diff.patch" 2>"$run/diff.err" || [ ! -s "$run/diff.patch" ]; then
      reason="no diff"
    else
      # The check runs from the real checkout, so the run tree cannot alter it.
      out=$(cd "$REPO_ROOT" && bash -c "$check \"\$@\"" se-check \
        "$run/wt" "$run/stream.jsonl" "$run/diff.patch" 2>"$run/check.err" | tail -n 1)
      case "$out" in
        PASS) result=pass ;;
        FAIL) result=fail ;;
        *) reason="check printed '${out}'" ;;
      esac
    fi
  fi
  printf '%s\n' "$result" >"$run/result"
  printf '%s\n' "$reason" >"$run/reason"
  [ -n "${STEERING_EVAL_KEEP:-}" ] || rm -rf "${run:?}/repo" "${run:?}/wt"
}

# Run the N ($6) runs of one arm in parallel under $5; print "pass fail error".
se_run_arm() {
  local rule="$1" arm="$2" model="$3" effort="$4" dir="$5" n="$6" i
  for ((i = 1; i <= n; i++)); do
    se_run_one "$rule" "$arm" "$model" "$effort" "$dir/$arm-$i" &
  done
  wait
  local p=0 f=0 e=0 r
  for ((i = 1; i <= n; i++)); do
    r=$(cat "$dir/$arm-$i/result" 2>/dev/null || echo error)
    case "$r" in pass) p=$((p + 1)) ;; fail) f=$((f + 1)) ;; *) e=$((e + 1)) ;; esac
  done
  echo "$p $f $e"
}

# The verdict from the control counts $1-$3 and the treatment counts $4-$6
# (empty when treatment did not run): `live`, `dead: control passes`,
# `dead: both arms fail` or `error`. An error never counts as a pass or a fail.
se_verdict() {
  local pc="$1" fc="$2" ec="$3" pt="${4:-}" et="${6:-}"
  if [ "$fc" -eq 0 ]; then
    if [ "$ec" -eq 0 ] && [ "$pc" -gt 0 ]; then echo "dead: control passes"; else echo error; fi
  elif [ -z "$pt" ]; then
    echo error
  elif [ "$pt" -gt "$pc" ]; then
    echo live
  elif [ "$et" -gt 0 ]; then
    echo error
  else
    echo "dead: both arms fail"
  fi
}

# The sentence printed under the table: how often a rule the model breaks one
# run in ten still passes every control run, for N ($1) runs on each of the
# three models.
se_odds_sentence() {
  local n="$1"
  awk -v n="$n" 'BEGIN {
    printf "With N=%d per model, a rule the model breaks one run in ten passes all %d control runs %.0f%% of the time. So `dead` means \"not broken often\", not \"never needed\".\n", n, 3 * n, 100 * 0.9 ^ (3 * n)
  }'
}

# "2/3" plus " (1 error)" when a run errored.
se_count() {
  local p="$1" e="$2" n="$3"
  if [ "$e" -gt 0 ]; then echo "$p/$n ($e error)"; else echo "$p/$n"; fi
}
