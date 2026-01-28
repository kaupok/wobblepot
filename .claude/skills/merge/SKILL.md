---
name: merge
description: Merge approved PR and clean up local branch
context: inherit
---

# Merge PR and Clean Up

Merges a PR using squash merge, then cleans up local state.

## Usage

```
/merge
```

Run this command while on a feature branch that has a PR.

## Workflow

### Step 1: Pre-flight Checks

Run these commands in parallel to gather state:

```bash
# Get current branch
git branch --show-current

# Check for uncommitted changes
git status --porcelain

# Get PR status
gh pr view --json number,title,state,headRefName,mergeable,mergeStateStatus,url 2>/dev/null
```

**Validation rules:**

| Check       | Fail Condition      | Error Message                                                                             |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Branch      | On `main`           | "You're on main. Switch to a feature branch with `git checkout <branch>`."                |
| PR exists   | No PR for branch    | "No PR found for this branch. Create one with `/pr` first."                               |
| Clean state | Uncommitted changes | "You have uncommitted changes. Commit with `/commit` or stash them first."                |
| PR state    | State is CLOSED     | "PR is closed. Cannot merge a closed PR."                                                 |
| Mergeable   | Not mergeable       | "PR cannot be merged. Status: {mergeStateStatus}. Check for conflicts or failing checks." |

If PR is already MERGED, skip to Step 6 (local cleanup only).

**Note:** Do NOT check for review approval. If the user asks to merge, merge it.

### Step 2: Wait for CI Checks

Before merging, ensure all CI checks have passed:

```bash
timeout 600 gh pr checks --watch --fail-fast --interval 10
```

**Behavior:**

- If checks already passed: Proceeds immediately
- If checks still running: Waits and shows progress (up to 10 minutes)
- If any check fails: Reports failure, stops (exit code != 0)
- If timeout expires: Reports timeout, stops

**On failure:** Report which checks failed and stop. Do not proceed to merge.

### Step 3: Detect Environment

Before merging, detect if we're in a worktree:

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

If outputs differ → **worktree mode**
If outputs same → **regular repo mode**

### Step 4: Merge the PR

**Regular repo mode:**

```bash
gh pr merge --squash --delete-branch
```

This command:

- Squash merges all commits into one
- Deletes the remote branch
- Handles the local branch deletion if possible

**Worktree mode:**

```bash
gh pr merge --squash
```

Omit `--delete-branch` because `gh` tries to checkout main internally, which conflicts with the parent worktree. The remote branch is still deleted by GitHub. The local worktree branch is preserved (user cleans up worktree manually).

### Step 5: Post Summary to Linear

After merging but before local cleanup, post a work summary to the linked Linear issue.

**Extract Linear issue ID** from the branch name saved in Step 1. Look for pattern `hon-XX` (case-insensitive) in the branch name. If no match, skip this step silently.

**Gather PR data:**

```bash
# PR details and files (works after merge — does not depend on branch)
gh pr view --json number,title,url,commits,files

# Review comments: inline comments + review-level summaries
gh api /repos/{owner}/{repo}/pulls/{number}/comments
gh api /repos/{owner}/{repo}/pulls/{number}/reviews
```

Extract owner/repo from `gh repo view --json nameWithOwner --jq .nameWithOwner`.

**Post comment to Linear:**

First fetch the issue UUID:

```
mcp__linear-server__get_issue({ id: "HON-XX" })
```

Then post:

```
mcp__linear-server__create_comment({
  issueId: "[issue-uuid-from-linear]",
  body: "[summary comment]"
})
```

**Comment template:**

```markdown
## Merged: PR #XX — type(scope): Title

**PR:** [#XX](url)

### Changes
- X files changed
- [file list with +/- stats from gh pr view --json files]

### Commits
- [commit messages from gh pr view --json commits]

### Review feedback addressed
- [summary of review comments that were addressed, or "No review feedback" if none]
```

**After posting**, print the summary to the terminal as well so the user can see it inline.

**Rules:**
- If no Linear issue ID found in branch name, skip this step entirely (no terminal output, no Linear post)
- If Linear API calls fail, still print the summary to terminal — don't block the merge flow
- Keep the summary concise — list files and stats, don't dump full diffs

### Step 6: Local Cleanup

Use the environment detected in Step 3.

**Regular repo mode:**

Save the branch name from Step 1, then:

```bash
# Switch to main
git checkout main

# Pull latest changes (includes the merged PR)
git pull origin main

# Delete local branch (-d may fail after squash merge, fallback to -D)
git branch -d {saved_branch_name} || git branch -D {saved_branch_name}
```

**Worktree mode:**

Cannot switch branches or delete the worktree branch from within. Fetch main updates and prepare cleanup info:

```bash
# Get worktree info for cleanup command
WORKTREE_PATH=$(pwd)
BRANCH_NAME=$(git branch --show-current)
MAIN_REPO=$(git rev-parse --git-common-dir | sed 's|/.git$||')

# Pull main updates into the worktree (for reference)
git fetch origin main:main
```

Save `WORKTREE_PATH`, `BRANCH_NAME`, and `MAIN_REPO` for the confirmation message.

### Step 7: Confirmation

Report success and output the completion marker.

**Regular repo mode:**

```
PR #{number} merged successfully.

- Remote branch deleted
- Local branch deleted
- Now on main with latest changes

View merged PR: {url}

[merge:complete] PR #{number} merged
```

**Worktree mode:**

```
PR #{number} merged successfully.

- Remote branch deleted
- Worktree branch preserved (cleanup needed)

View merged PR: {url}

To clean up, exit this directory and run:
  cd {MAIN_REPO} && ./scripts/worktree-claude.sh cleanup {BRANCH_NAME}

Or if you have `wt` alias: wt cleanup {BRANCH_NAME}
Or if you have `git bdone`: git bdone

[merge:complete] PR #{number} merged
```

## Error Recovery

**Merge failed mid-way:**

- If merge succeeded but checkout failed: Report merge success, guide user to manually run `git checkout main && git pull`
- If merge failed: Report the error from `gh pr merge`, do not proceed with cleanup

**Branch deletion failed:**

- Report success for merge, warn about manual branch cleanup needed
- Provide command: `git branch -D {branch_name}`
