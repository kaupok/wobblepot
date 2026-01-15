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

If PR is already MERGED, skip to Step 4 (local cleanup only).

**Note:** Do NOT check for review approval. If the user asks to merge, merge it.

### Step 2: Wait for CI Checks

Before merging, ensure all CI checks have passed:

```bash
gh pr checks --watch --fail-fast --interval 10
```

**Behavior:**

- If checks already passed: Proceeds immediately
- If checks still running: Waits and shows progress
- If any check fails: Reports failure, stops (exit code != 0)

**On failure:** Report which checks failed and stop. Do not proceed to merge.

**Note:** The `--watch` flag handles all polling automatically. No custom loop needed.

### Step 3: Merge the PR

```bash
gh pr merge --squash --delete-branch
```

This command:

- Squash merges all commits into one
- Deletes the remote branch
- Handles the local branch deletion if possible

### Step 4: Local Cleanup

First, detect if we're in a worktree:

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

If outputs differ → **worktree mode**
If outputs same → **regular repo mode**

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

### Step 5: Confirmation

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
