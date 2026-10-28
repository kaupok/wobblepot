# shellcheck shell=bash
# The `claude` run at the end of `wt auto` (HON-1413). Sourced by
# worktree-claude.sh's cmd_auto.
#
# A short network drop used to kill the worker: Claude Code prints "API Error:
# Can't reach the API server" and exits 1, and the session's plan, review
# findings and work in progress were lost. So an unattended run waits for the
# API to answer again and continues the same session, at most 3 times. The
# first call takes its own `--session-id` and a resume names it with
# `--resume`: `--continue` would take the newest session in the worktree, and
# pr-review.sh runs its own `claude -p` there. Any other failure exits as
# before. The orchestrator's WORKER_TIMEOUT bounds the waits too, and its
# kill_process_tree reaches `claude`, `curl` and `sleep` as children.

WT_AUTO_MAX_RESUMES=3
WT_AUTO_NETWORK_POLL=15

# wt_auto_claude <prompt> [flag...]: runs `claude` with the flags,
# CLAUDE_MODEL_ARGS and CLAUDE_MCP_ARGS (models.sh) and the prompt. Unset
# ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API
# credits. Unset ORCHESTRATOR_RETRY_CONTEXT too: cmd_auto consumed it
# into the prompt, and the worker runs `pnpm test`, which sources these
# scripts — a leaked value would make every script under test see a retry
# (HON-728). CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0 keeps a slow MCP call (Linear,
# Playwright) in the foreground. Claude Code otherwise backgrounds one after 2
# minutes, and this headless worker exits when its turn ends, so the turn can
# end before the result arrives and the result is lost (HON-1119). `--` ends
# --mcp-config's values so the prompt stays a prompt (HON-1238). `exec`, so in
# a pipeline `claude` replaces its subshell and is a direct child of the `wt
# auto` shell, which the kill the `wt stop` drain check prints reaches.
wt_auto_claude() {
  local prompt="$1"
  shift
  exec env -u ANTHROPIC_API_KEY -u ORCHESTRATOR_RETRY_CONTEXT \
    CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0 claude "$@" --dangerously-skip-permissions \
    "${CLAUDE_MODEL_ARGS[@]}" "${CLAUDE_MCP_ARGS[@]}" -- "$prompt"
}

# True when the end of a run's output is Claude Code's network error. The
# apostrophe can be straight or curly.
wt_auto_network_drop() {
  tail -n 5 "$1" | grep -qE "Can('|’)t reach the API server|API Error.*(ENOTFOUND|ECONNRESET)"
}

# Polls the API every WT_AUTO_NETWORK_POLL seconds until it answers. Any HTTP
# answer counts, so no -f. Fails after WT_AUTO_NETWORK_WAIT seconds.
wt_auto_wait_for_api() {
  local deadline=$((SECONDS + ${WT_AUTO_NETWORK_WAIT:-1800})) left
  while :; do
    curl -sS -o /dev/null --max-time 10 https://api.anthropic.com 2>/dev/null && return 0
    left=$((deadline - SECONDS))
    [ "$left" -le 0 ] && return 1
    sleep $((left < WT_AUTO_NETWORK_POLL ? left : WT_AUTO_NETWORK_POLL))
  done
}

# run_auto_claude <prompt> <issue-id>: returns claude's last exit code. The
# issue ID is empty when `wt auto` runs discovery.
run_auto_claude() {
  local prompt="$1" issue="$2" resumes=0 rc out sid
  # An interactive run keeps its TTY and does not resume: a pipe would take the
  # TTY from Claude Code's UI, and a human is watching.
  if [ -t 1 ]; then
    (wt_auto_claude "$prompt")
    return
  fi
  out=$(mktemp)
  # uuidgen is on macOS; a Linux runner may only have the kernel's.
  sid=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
  sid=$(printf '%s' "$sid" | tr '[:upper:]' '[:lower:]')
  # The orchestrator sends both streams to the worker log already, so 2>&1
  # keeps the log the same and lets the check see an error on stderr.
  wt_auto_claude "$prompt" --session-id "$sid" 2>&1 | tee "$out"
  rc=${PIPESTATUS[0]}
  while [ "$rc" -ne 0 ] && [ "$resumes" -lt "$WT_AUTO_MAX_RESUMES" ] && wt_auto_network_drop "$out"; do
    echo "[wt auto] Network drop — waiting for the Claude API"
    wt_auto_wait_for_api || break
    resumes=$((resumes + 1))
    echo "[wt auto] Network back — continuing the session (resume $resumes/$WT_AUTO_MAX_RESUMES)"
    prompt="The network dropped and stopped this session. Continue /auto-implement${issue:+ $issue} from where you stopped."
    wt_auto_claude "$prompt" --resume "$sid" 2>&1 | tee "$out"
    rc=${PIPESTATUS[0]}
  done
  rm -f "$out"
  return "$rc"
}
