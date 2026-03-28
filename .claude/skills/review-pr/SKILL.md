---
name: review-pr
description: Run the Claude PR reviewer on the current branch's PR. Posts findings as GitHub comments.
context: inherit
---

# Review PR

Run the Claude PR reviewer (Opus) on the current branch's PR. The reviewer reads the diff, explores the codebase, and posts findings as GitHub PR comments.

## Usage

- `/review-pr` — Review the PR for the current branch
- `/review-pr 438` — Review a specific PR by number

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
./scripts/pr-review.sh ${PR_NUMBER}
```

This runs synchronously. The script handles model selection (Opus), locking, and prompt formatting.

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
