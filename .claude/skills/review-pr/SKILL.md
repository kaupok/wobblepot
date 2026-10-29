---
name: review-pr
description: Run the Claude PR reviewer on the current branch's PR. Posts findings as GitHub comments.
context: inherit
---

# Review PR

Run the Claude PR reviewer on the current branch's PR using `REVIEW_MODEL` at `REVIEW_EFFORT` from `scripts/models.sh` (overridable with `CLAUDE_REVIEW_MODEL` and `CLAUDE_REVIEW_EFFORT`). The reviewer reads the diff, explores the codebase, and posts findings as GitHub PR comments.

## Usage

- `/review-pr` — Review the PR for the current branch
- `/review-pr 438` — Review a specific PR by number

## When to run it

PR review is automatic, so do not run this skill by hand in the CLAUDE.md skill sequence. `/commit --pr` chains to `/create-pr`, whose final step invokes this skill → `scripts/pr-review.sh`, which posts findings as a PR comment marked `<!-- claude-review -->`. The reviewer also checks the diff against the linked issue's acceptance criteria and lists any gap under a separate `**Spec:**` heading. `/triage-pr-comments` consumes that marker; `/auto-implement` calls the same script directly.

A PR opened with a raw `gh pr create` skips that first trigger, but the review is not lost: `/triage-pr-comments` step 2 runs the reviewer when the marker count is 0, and `/merge` step 2.5 does the same before merging (bypass with `/merge --force`). Run this skill directly only to re-review after a force-push, or to review a PR you did not open.

## Workflow

### 1. Determine PR number

If an argument is provided, use it as the PR number.

Otherwise, get it from the current branch:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)
```

If no PR exists, inform user: "No PR found for this branch. Create one with `/create-pr` first."

### 2. Run the reviewer

```bash
# Fresh shell — re-derive (or substitute the literal number given as the argument)
PR_NUMBER=$(gh pr view --json number --jq .number)
./scripts/pr-review.sh ${PR_NUMBER}
```

`./scripts/pr-review.sh --local <ISSUE_ID>` runs the same prompt on the branch's local changes before a PR exists, writes the summary to `/tmp/auto-implement-local-review-<ISSUE_ID>.md` and posts nothing (`/auto-implement` 4.3).

This runs synchronously. The script handles model selection (`REVIEW_MODEL` from `scripts/models.sh`, overridable with `CLAUDE_REVIEW_MODEL`), locking, and prompt formatting.

It spawns `claude -p` and takes several minutes. Run it with `timeout: 600000` (or `run_in_background: true` and poll for the `<!-- claude-review -->` comment) — the default 120 s Bash timeout kills it mid-run and leaves a stale `/tmp/claude-review-N.lock`.

### 3. Report result

If the script exits 0:

```
[review-pr:complete] Review posted for PR #${PR_NUMBER}
```

If the script exits non-zero:

```
[review-pr:error] Review failed for PR #${PR_NUMBER}
```

Report the error output to the user.
