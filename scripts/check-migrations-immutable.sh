#!/usr/bin/env bash
# Guardrail (HON-641): a Prisma migration is immutable once it is on `main`.
#
# Prisma records a SHA-256 of each `migration.sql` in the database's
# `_prisma_migrations` table at apply time. Editing the file afterwards leaves
# the stored checksum pointing at content that no longer exists, and
# `prisma migrate dev` then refuses to run at all — its only built-in remedy is
# a full schema reset. That is how the dev database in HON-558 was bricked.
#
# A migration that reached `main` has been applied somewhere durable:
# deploy-db-migrations-staging.yml runs `prisma migrate deploy` on every merge,
# and production applies the same files. So there is no such thing as a safe
# edit — fix forward with a new migration instead.
#
# Usage: bash scripts/check-migrations-immutable.sh <BASE_REF>
#   e.g. git fetch origin main && bash scripts/check-migrations-immutable.sh origin/main
#        bash scripts/check-migrations-immutable.sh --tree
#
# Fetch first when BASE_REF is a remote-tracking ref: `origin/main` only moves
# on `git fetch`, and a stale one omits migrations that landed on main since —
# editing one of those then reads as `A`, the allowed status, and passes.
#
# Two modes, one per CI event (see .github/workflows/ci.yml):
#
#   <BASE_REF>  Prevention, on every pull request against the PR base sha:
#               fails if this branch changes a migration the base already has.
#   --tree      Detection, on every push to `main` (HON-649, HON-671): fails if
#               any migration.sql at HEAD differs from the blob it was first
#               added with on `main`'s first-parent history, or if one was
#               deleted. Unlike a `before..HEAD` range, this stays red on every
#               later push until the edit is reverted, so an unrelated merge
#               cannot turn `main` green over the drift.
#
# `--tree` assumes each first-parent commit on `main` is one merge unit — a
# squash (what `/merge` does) or a merge commit, whose first-parent diff covers
# the whole PR. A rebase merge, or a direct push of several commits, lands a
# PR's intermediate commits too: a new migration added in one and fixed up in
# the next then reads as edited, although only the final bytes were ever on a
# pushed `main` tip and applied. Reverting there would CREATE drift — pin the
# final blob in the allowlist instead (the repo still allows rebase merges).
#
# `--tree` accepts a post-add edit only when scripts/migration-immutability-
# allowlist.txt pins that path to HEAD's exact blob (or to `deleted`), with a
# reason — see the header of that file. It costs one `git log` over full
# history per migration (~30 today, well under a second each); revisit with a
# single-pass walk once there are a few hundred.
set -eu

# --tree ---------------------------------------------------------------------
tree_mode() {
  # Pathspecs and the allowlist path are repo-relative, so anchor to the top
  # of the working tree — run from a subdirectory, they would match nothing
  # and report a confident pass.
  cd "$(git rev-parse --show-toplevel)"

  # A shallow clone's boundary commit diffs against the empty tree, so every
  # migration reads as added there, with whatever bytes it holds by then —
  # the check would compare edited files against themselves and pass.
  if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
    echo "ERROR: --tree needs full history, and this clone is shallow." >&2
    echo "Check out with \`fetch-depth: 0\` (or run \`git fetch --unshallow\`)." >&2
    exit 2
  fi

  local allowlist=scripts/migration-immutability-allowlist.txt
  # Read from HEAD, the tree being checked, rather than the working tree —
  # the pin and the file it pins must come from the same commit. A missing
  # file is an empty allowlist: the strictest reading, never a looser one.
  local pins="" content="" lineno=0 line path blob why
  if git cat-file -e "HEAD:$allowlist" 2>/dev/null; then
    content=$(git show "HEAD:$allowlist")
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    case "$line" in \#*) continue ;; esac
    path="" blob="" why=""
    read -r path blob why <<<"$line" || true
    [ -n "$path" ] || continue
    # A line that does not parse is an error, not a skip: a silently dropped
    # pin turns into a red `main` with no hint why, and a pin that parsed
    # wrong could accept content nobody reviewed.
    if [ -z "$why" ] ||
      ! [[ "$blob" =~ ^([0-9a-f]{40}|[0-9a-f]{64}|deleted)$ ]] ||
      ! [[ "$path" =~ ^prisma/migrations/[^/]+/migration\.sql$ ]]; then
      echo "ERROR: $allowlist:$lineno is malformed:" >&2
      echo "  $line" >&2
      echo "Expected: <prisma/migrations/<dir>/migration.sql> <blob-sha|deleted> <why>" >&2
      exit 2
    fi
    if printf '%s\n' "$pins" | awk -v p="$path" '$1 == p { found = 1 } END { exit !found }'; then
      echo "ERROR: $allowlist:$lineno pins $path a second time — keep one entry per path." >&2
      exit 2
    fi
    pins="${pins}${path} ${blob}"$'\n'
  done <<EOF
$content
EOF

  local failures="" checked=0 allowed=0 f added head_blob added_blob
  local files
  files=$(git -c core.quotePath=false ls-tree -r --name-only HEAD -- prisma/migrations |
    grep '/migration\.sql$' || true)

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    checked=$((checked + 1))
    # The OLDEST add, not the newest: a migration deleted and later restored
    # must still match what the database recorded the first time. With the
    # newest add it would be compared against its own re-add and always pass.
    # `--no-renames` so a moved file reads as D + A rather than R.
    added=$(git log --first-parent --no-renames --diff-filter=A --format=%H HEAD -- ":(literal)$f" | tail -n 1)
    if [ -z "$added" ]; then
      echo "ERROR: no first-parent commit adds $f — cannot establish its applied content." >&2
      exit 2
    fi
    head_blob=$(git rev-parse "HEAD:$f")
    added_blob=$(git rev-parse "$added:$f")
    [ "$head_blob" = "$added_blob" ] && continue
    if printf '%s\n' "$pins" | grep -Fxq "$f $head_blob"; then
      allowed=$((allowed + 1))
      continue
    fi
    failures="${failures}  edited   $f (added in ${added:0:12}, now blob $head_blob)"$'\n'
  done <<EOF
$files
EOF

  local deleted
  deleted=$(git -c core.quotePath=false log --first-parent --no-renames --diff-filter=D \
    --name-only --format= HEAD -- 'prisma/migrations/*/migration.sql' | sort -u)

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # Present at HEAD again means it was restored — the loop above has already
    # compared it against its original bytes.
    git cat-file -e "HEAD:$f" 2>/dev/null && continue
    if printf '%s\n' "$pins" | grep -Fxq "$f deleted"; then
      allowed=$((allowed + 1))
      continue
    fi
    added=$(git log --first-parent --no-renames --diff-filter=A --format=%H HEAD -- ":(literal)$f" | tail -n 1)
    failures="${failures}  deleted  $f (added in ${added:0:12})"$'\n'
  done <<EOF
$deleted
EOF

  if [ -n "$failures" ]; then
    echo "ERROR: HEAD holds applied migrations that no longer match what was first merged:" >&2
    printf '%s' "$failures" >&2
    echo "These edits have already landed, so do NOT fix forward: staging and production" >&2
    echo "still hold the checksum of the original SQL, and only restoring those bytes" >&2
    echo "clears the drift. Revert the commit that made each change (git revert) — this" >&2
    echo "check goes green on the revert's own push. Keeping an edit is only sanctioned" >&2
    echo "through a reviewed entry in $allowlist, with a reason." >&2
    echo "Exception: if the add and the edit arrived in the SAME push (a rebase merge or" >&2
    echo "a multi-commit push), only the final bytes were ever applied — do not revert;" >&2
    echo "pin HEAD's blob in the allowlist instead." >&2
    echo "See CLAUDE.md → Database Patterns." >&2
    if [ "${GITHUB_ACTIONS-}" = true ]; then
      echo "::error title=Applied migration edited on main::A migration.sql at HEAD differs from the bytes it was merged with. Revert the commit that changed it; see the step log and CLAUDE.md → Database Patterns."
    fi
    exit 1
  fi

  echo "check-migrations-immutable: OK — $checked migrations at HEAD checked; each matches the bytes it was merged with or an allowlist pin ($allowed allowlisted)"
}

if [ "${1-}" = "--tree" ]; then
  tree_mode
  exit 0
fi

BASE_REF=${1-}

if [ -z "$BASE_REF" ]; then
  echo "ERROR: missing BASE_REF." >&2
  echo "Usage: bash scripts/check-migrations-immutable.sh <BASE_REF> | --tree" >&2
  exit 2
fi

if ! git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null; then
  echo "ERROR: '$BASE_REF' does not resolve to a commit." >&2
  echo "Fetch it first: git fetch --no-tags origin <ref>" >&2
  echo "Do not add --depth — a shallow fetch resolves the ref but destroys the" >&2
  echo "merge base, and every migration the base gained since the fork point" >&2
  echo "then reads as a deletion by this branch." >&2
  exit 2
fi

# The range we want is `BASE...HEAD` — everything this branch added on top of
# the fork point, ignoring what landed on the base since. Three-dot needs a
# merge base, so resolve it explicitly rather than relying on the `A...B` form,
# which dies outright when there is none.
#
# CI takes the first branch: ci.yml checks out with `fetch-depth: 0` precisely
# so this resolves. The fallback is for shallow or grafted history, where the
# two trees are compared directly. That is a weaker guarantee — anything the
# base has and the checkout lacks reads as `D`, so a branch merely behind the
# base can be blamed for a migration it never touched — which is why taking it
# says so on stderr instead of passing silently.
FALLBACK=false
if DIFF_BASE=$(git merge-base "$BASE_REF" HEAD 2>/dev/null); then
  :
else
  DIFF_BASE=$BASE_REF
  FALLBACK=true
  echo "note: no merge base with '$BASE_REF' (shallow history?) — comparing trees directly." >&2
fi

# `core.quotePath=false` keeps non-ASCII paths unescaped so they print (and
# match) as themselves. Fields are tab-separated, so a path containing spaces
# still parses correctly; a rename emits three fields (status, old, new).
#
# The `:/` pathspec prefix anchors to the top of the working tree. A plain
# `prisma/migrations/` would be resolved relative to the caller's directory, so
# running this from anywhere but the repo root would match nothing and report a
# confident pass — the one outcome a guard must never produce by accident.
#
# No second revision, so the comparison runs against the **working tree**
# rather than HEAD. In CI that is the same thing (the checkout is clean), but
# locally docs/GIT_WORKFLOW.md puts this run at step 5 — after `git add -A` and
# before `git commit` — where a staged edit is not in HEAD yet and naming HEAD
# would report a confident pass on exactly the change CI is about to reject.
# An untracked new migration then goes unlisted, which costs nothing: `A` is
# the allowed status anyway.
DIFF=$(git -c core.quotePath=false diff --name-status "$DIFF_BASE" -- ':/prisma/migrations/')

# Only `A` (a brand-new migration) is legitimate. Everything else on a
# `migration.sql` — M, D, R*, and the rarer C*/T — changes or removes SQL that
# has already been applied. Allow-listing the one safe status rather than
# enumerating the unsafe ones means a status nobody thought of fails closed.
violations=""
while IFS=$'\t' read -r status old new; do
  [ -n "$status" ] || continue
  case "$status" in
    A*) continue ;;
  esac
  # A rename is a violation from either end: the SQL that was applied is gone
  # from its old path, and whatever now sits at the new path is not what the
  # database recorded.
  for path in "$old" "$new"; do
    case "$path" in
      */migration.sql) violations="${violations}  $status  $path"$'\n' ;;
    esac
  done
done <<EOF
$DIFF
EOF

if [ -n "$violations" ]; then
  if [ "$FALLBACK" = true ]; then
    # Without a merge base there is no way to tell "this branch changed it"
    # from "the base has it and this tree does not", so the header must not
    # claim authorship it cannot establish.
    echo "ERROR: this tree differs from $BASE_REF on migrations it already has:" >&2
  else
    echo "ERROR: this branch changes migrations that already exist on $BASE_REF:" >&2
  fi
  printf '%s' "$violations" >&2
  echo "Migrations already on main are immutable — fix forward with a new migration." >&2
  echo "Editing an applied migration.sql breaks its recorded checksum and makes" >&2
  echo "\`prisma migrate dev\` demand a full database reset (HON-558)." >&2
  echo "See CLAUDE.md → Database Patterns." >&2
  exit 1
fi

echo "check-migrations-immutable: OK — no migration already on $BASE_REF was changed"
