#!/bin/bash
# Fetch every comment of one kind on a PR, as one JSON array.
#
# Usage:
#   ./scripts/pr-comments.sh <PR_NUMBER> inline|reviews|issue [--head <sha>]
#
#   inline   → /pulls/N/comments  (inline review comments, on a diff line)
#   reviews  → /pulls/N/reviews   (review submissions: state and summary body)
#   issue    → /issues/N/comments (PR conversation, incl. the <!-- claude-review --> summary)
#
# --head <sha> keeps only records whose `commit_id` is <sha>. Only `inline` and
# `reviews` carry a commit. On `inline` GitHub re-points `commit_id` to the new head
# when a comment's anchor survives a push, so the filter does not separate an earlier
# round's addressed finding from a live one (.claude/skills/auto-implement/history.md
# → Stale inline comments, HON-585). On `reviews` it is the commit reviewed.
#
# Prints one JSON array of objects with the fields the skills read: id, body, path,
# line, original_line, diff_hunk, commit_id, user.login, in_reply_to_id, state,
# created_at, submitted_at. A field the endpoint does not return is null. GitHub
# orders records oldest first, so `last` is the newest.
#
# Exits non-zero, with a message on stderr and nothing on stdout, when the fetch
# fails or produces no output. A PR with no comments prints `[]` and exits 0, so an
# empty stdout at a call site is a failed fetch, never "no comments".
#
# Why the fetch looks like this (HON-586):
# - `--paginate` is mandatory. Without it the API returns only the first page (30 by
#   default, 100 here), and since GitHub orders oldest first, the newest round is the
#   page that gets dropped.
# - `--jq` is deliberately NOT used: gh applies it once per page, so `length` or
#   `last` would emit one result per page. `jq -s 'add'` folds the page stream into a
#   single array first. Do not "simplify" this back to --jq.
# - `add // error(...)`, not bare `add` and not `add // []`: bare `add` over an empty
#   slurp prints `null` and exits 0, and `// []` would turn a failed fetch (network,
#   auth, rate limit) into a confident "no comments". A genuinely empty `[]` page
#   still passes — only null and false are falsy to `//`.
# Uses the system `jq`, not gh's embedded one.
#
# Tested by scripts/pr-comments.test.ts.

set -euo pipefail

usage() {
  echo "Usage: $0 <PR_NUMBER> inline|reviews|issue [--head <sha>]" >&2
  exit 2
}

[ $# -ge 2 ] || usage
PR_NUMBER="$1"
KIND="$2"
shift 2
HEAD_SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --head)
      [ $# -ge 2 ] && [ -n "$2" ] || usage
      HEAD_SHA="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

case "$PR_NUMBER" in
  '' | *[!0-9]*) echo "pr-comments.sh: PR number must be numeric, got '$PR_NUMBER'" >&2; exit 2 ;;
esac

case "$KIND" in
  inline) ENDPOINT="pulls/${PR_NUMBER}/comments" ;;
  reviews) ENDPOINT="pulls/${PR_NUMBER}/reviews" ;;
  issue)
    ENDPOINT="issues/${PR_NUMBER}/comments"
    if [ -n "$HEAD_SHA" ]; then
      echo "pr-comments.sh: --head needs inline or reviews; issue comments carry no commit" >&2
      exit 2
    fi
    ;;
  *) usage ;;
esac

# `:owner/:repo` is filled in by gh from the current git remote. Captured first, not
# piped: a fetch that fails on page 2 must print nothing, not page 1 as the whole.
PAGES=$(gh api --paginate "/repos/:owner/:repo/${ENDPOINT}?per_page=100") || {
  echo "pr-comments.sh: gh api failed for ${ENDPOINT}" >&2
  exit 1
}
printf '%s' "$PAGES" \
  | jq -s --arg head "$HEAD_SHA" '
      (add // error("pr-comments.sh: the fetch produced no output"))
      | map(select($head == "" or .commit_id == $head))
      | map({
          id, body, path, line, original_line, diff_hunk, commit_id,
          user: {login: .user.login},
          in_reply_to_id, state, created_at, submitted_at
        })'
