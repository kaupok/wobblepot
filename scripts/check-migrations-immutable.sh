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
#
# Fetch first when BASE_REF is a remote-tracking ref: `origin/main` only moves
# on `git fetch`, and a stale one omits migrations that landed on main since —
# editing one of those then reads as `A`, the allowed status, and passes.
#
# Run in CI on every pull request (see .github/workflows/ci.yml). Skipped on
# push to `main`: there is no base to diff against, and `main` is what the
# check protects.
set -eu

BASE_REF=${1-}

if [ -z "$BASE_REF" ]; then
  echo "ERROR: missing BASE_REF." >&2
  echo "Usage: bash scripts/check-migrations-immutable.sh <BASE_REF>" >&2
  exit 2
fi

if ! git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null; then
  echo "ERROR: '$BASE_REF' does not resolve to a commit." >&2
  echo "In CI, fetch it first: git fetch --no-tags --depth=1 origin <base sha>" >&2
  exit 2
fi

# The range we want is `BASE...HEAD` — everything this branch added on top of
# the fork point, ignoring what landed on the base since. Three-dot needs a
# merge base, and CI checks out shallow (actions/checkout defaults to depth 1),
# where the histories are grafted and `git diff A...B` can die with "no merge
# base". Resolve it explicitly instead: use the merge base when git can find
# one, otherwise diff the two trees directly. On a pull_request the shallow
# checkout is GitHub's merge ref, which already contains the base — so its tree
# differs from the base's by exactly the PR's own changes, which is what the
# three-dot form would have produced anyway.
if ! DIFF_BASE=$(git merge-base "$BASE_REF" HEAD 2>/dev/null); then
  DIFF_BASE=$BASE_REF
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
  echo "ERROR: this branch changes migrations that already exist on $BASE_REF:" >&2
  printf '%s' "$violations" >&2
  echo "Migrations already on main are immutable — fix forward with a new migration." >&2
  echo "Editing an applied migration.sql breaks its recorded checksum and makes" >&2
  echo "\`prisma migrate dev\` demand a full database reset (HON-558)." >&2
  echo "See CLAUDE.md → Database Patterns." >&2
  exit 1
fi

echo "check-migrations-immutable: OK — no migration already on $BASE_REF was changed"
