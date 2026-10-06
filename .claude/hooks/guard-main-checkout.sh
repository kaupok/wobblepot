#!/usr/bin/env bash
# PreToolUse hook for Bash, Edit, Write and NotebookEdit: blocks file changes in
# the main checkout, so a session moves into its own worktree at its first
# write. The logic lives in guard-main-checkout.mts; see its header.
exec node --no-warnings "$(dirname "$0")/guard-main-checkout.mts"
