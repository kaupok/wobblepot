#!/usr/bin/env bash
# WorktreeCreate hook: builds the worktree Claude Code asks for (EnterWorktree,
# `claude -w`, a subagent with isolation: worktree) with `wt prepare`, so it
# lands in ~/.worktrees/wobblepot/ with .env, node_modules and the Prisma
# client, like the orchestrator's worktrees. The hook input's `name` becomes
# the branch name; an issue ID (`hon-123`) becomes the issue's Linear branch,
# because EnterWorktree rejects a name over 64 characters. Stdout must carry
# the worktree path and nothing else.
set -euo pipefail
name=$(node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>process.stdout.write(JSON.parse(s).name??""))')
if [ -z "$name" ]; then
  echo "worktree-create hook: no name in the hook input" >&2
  exit 1
fi
exec "$(dirname "$0")/../../scripts/worktree-claude.sh" prepare "$name"
