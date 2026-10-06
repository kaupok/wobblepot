#!/usr/bin/env bash
# WorktreeRemove hook: hands the worktree to `wt release`, which removes it only
# when it has no changes and no commits past origin/main. A worktree with work
# in it stays for `wt done` after the merge.
set -euo pipefail
worktree_path=$(node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>process.stdout.write(JSON.parse(s).worktree_path??""))')
exec "$(dirname "$0")/../../scripts/worktree-claude.sh" release "$worktree_path"
