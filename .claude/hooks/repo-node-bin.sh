#!/usr/bin/env bash
# Prints the bin directory of a Node whose major matches .nvmrc, or nothing
# when the Node on PATH already matches. A desktop app (T3 Code, an IDE) keeps
# the PATH it started with, so after nvm replaces 22.x.y that PATH points at a
# removed folder and `node` falls through to Homebrew's newer Node. engine-strict
# in .npmrc then fails `pnpm install` in every new worktree.
set -uo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
want=$(tr -d '[:space:]v' < "$repo_root/.nvmrc" 2>/dev/null)
want=${want%%.*}
[ -n "$want" ] || exit 0
have=$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')
[ "$have" = "$want" ] && exit 0
candidates=()
nvm_dir="${NVM_DIR:-$HOME/.nvm}"
while IFS= read -r dir; do
  candidates+=("$dir/bin")
done < <(printf '%s\n' "$nvm_dir/versions/node/v$want."* | sort -rV)
for prefix in /opt/homebrew /usr/local; do
  candidates+=("$prefix/opt/node@$want/bin")
done
for bin in "${candidates[@]}"; do
  if [ -x "$bin/node" ]; then
    echo "$bin"
    exit 0
  fi
done
echo "repo-node-bin: no Node $want found (have ${have:-none}); install it with nvm" >&2
