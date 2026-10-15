# shellcheck shell=bash disable=SC2034  # read by the scripts that source this file
# Claude models for the agentic workflow (HON-730). The only file under scripts/
# that names a model ID for the workflow; everything else reads these variables.
#
# Sourced, never executed, by:
#   worktree-claude.sh  AUTO_MODEL, AUTO_EFFORT      every `wt auto` worker (/auto-implement)
#   pr-review.sh        REVIEW_MODEL, REVIEW_EFFORT  the PR reviewer
#   orchestrator.sh     TRIAGE_MODEL, TRIAGE_EFFORT  the failed-worker triage call
#   orchestrator.sh     AUTO_MODEL_SMALL, AUTO_EFFORT_SMALL  a worker for an issue
#                       labelled `Small`, passed to `wt auto --model --effort` (HON-1193)
#
# Each one is overridable by its CLAUDE_* env var. A .env line reaches
# every variable but the reviewer's through `wt`; pr-review.sh does not read
# .env, so REVIEW_MODEL and REVIEW_EFFORT only see it inside a `wt auto` worker.
# Changing a default is a human decision taken with the swap test in
# docs/PARALLEL_WORKFLOW.md → Swapping models.
#
# These are the WORKFLOW models. The in-app AI models are in src/lib/ai (see
# docs/AI_MODELS.md).

AUTO_MODEL="${CLAUDE_AUTO_MODEL:-claude-opus-5-5}"
REVIEW_MODEL="${CLAUDE_REVIEW_MODEL:-claude-opus-5-5}"
TRIAGE_MODEL="${CLAUDE_TRIAGE_MODEL:-claude-sonnet-5}"
AUTO_MODEL_SMALL="${CLAUDE_AUTO_MODEL_SMALL:-claude-sonnet-5-5}"

# `claude --effort` levels: low, medium, high, xhigh, max. An empty value passes
# no flag, so the CLI's default applies. The single-dash expansion is deliberate:
# an unset override takes the default, but one set to empty stays empty, so
# `CLAUDE_REVIEW_EFFORT=` switches the flag off.
AUTO_EFFORT="${CLAUDE_AUTO_EFFORT-}"
REVIEW_EFFORT="${CLAUDE_REVIEW_EFFORT-medium}"
TRIAGE_EFFORT="${CLAUDE_TRIAGE_EFFORT-low}"
AUTO_EFFORT_SMALL="${CLAUDE_AUTO_EFFORT_SMALL-low}"

# The model flags for one `claude` call: `--model <model>`, plus
# `--effort <effort>` when the effort is non-empty. Sets the array
# CLAUDE_MODEL_ARGS, so a caller expands it as "${CLAUDE_MODEL_ARGS[@]}".
claude_model_args() {
  CLAUDE_MODEL_ARGS=(--model "$1")
  if [ -n "${2:-}" ]; then
    CLAUDE_MODEL_ARGS+=(--effort "$2")
  fi
}

# The MCP flags for one `claude` call: `--strict-mcp-config --mcp-config <json>`,
# where the JSON holds only the named servers, copied from .mcp.json so they
# cannot drift from it. No names gives the empty config. Sets the array
# CLAUDE_MCP_ARGS. Every server that starts adds its tools to the base prefix,
# which a run pays on every request (HON-1238). The caller puts `--` before the
# prompt, because --mcp-config takes several values and would read it as a file.
claude_mcp_args() {
  local mcp_json="${MCP_JSON_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.mcp.json}"
  local config='{"mcpServers":{}}'
  if [ "$#" -gt 0 ]; then
    config=$(jq -c '{mcpServers: (.mcpServers | with_entries(select(.key as $k | $ARGS.positional | index($k))))}' "$mcp_json" --args "$@") || return 1
  fi
  CLAUDE_MCP_ARGS=(--strict-mcp-config --mcp-config "$config")
}
