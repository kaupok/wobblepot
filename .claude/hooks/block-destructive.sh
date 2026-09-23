#!/usr/bin/env bash
# PreToolUse hook for Bash (HON-727): blocks destructive database commands,
# pushes to main, force pushes, and un-opted-in PR merges. The logic lives in
# block-destructive.mts (Node strips the types natively); see its header.
exec node --no-warnings "$(dirname "$0")/block-destructive.mts"
