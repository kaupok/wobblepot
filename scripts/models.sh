# shellcheck shell=bash disable=SC2034  # read by the scripts that source this file
# Claude models for the agentic workflow (HON-730). The only file under scripts/
# that names a model ID for the workflow; everything else reads these variables.
#
# Sourced, never executed, by:
#   worktree-claude.sh  AUTO_MODEL    every `wt auto` worker (/auto-implement)
#   pr-review.sh        REVIEW_MODEL  the PR reviewer
#   orchestrator.sh     TRIAGE_MODEL  the failed-worker triage call
#
# Each one is overridable by its CLAUDE_*_MODEL env var. A .env line reaches
# AUTO_MODEL and TRIAGE_MODEL through `wt`; pr-review.sh does not read .env, so
# REVIEW_MODEL only sees it when run inside a `wt auto` worker.
# Changing a default is a human decision taken with the swap test in
# docs/PARALLEL_WORKFLOW.md → Swapping models.
#
# These are the WORKFLOW models. The in-app AI models are in src/lib/ai (see
# docs/AI_MODELS.md).

AUTO_MODEL="${CLAUDE_AUTO_MODEL:-claude-opus-5-5}"
REVIEW_MODEL="${CLAUDE_REVIEW_MODEL:-claude-opus-5-5}"
TRIAGE_MODEL="${CLAUDE_TRIAGE_MODEL:-claude-sonnet-5}"
