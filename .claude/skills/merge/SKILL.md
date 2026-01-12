---
name: merge
description: Merge approved PR and clean up local branch
context: inherit
---

# Merge PR and Clean Up

Merges an approved PR using squash merge, then cleans up local state.

## Usage

```
/merge
```

Run this command while on a feature branch that has an approved PR.

## Workflow

### Step 1: Pre-flight Checks

Run these commands in parallel to gather state:

```bash
# Get current branch
git branch --show-current

# Check for uncommitted changes
git status --porcelain

# Get PR status
gh pr view --json number,title,state,headRefName,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,url
```

**Validation rules:**

| Check       | Fail Condition      | Error Message                                                                             |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Branch      | On `main`           | "You're on main. Switch to a feature branch with `git checkout <branch>`."                |
| PR exists   | No PR for branch    | "No PR found for this branch. Create one with `/pr` first."                               |
| Clean state | Uncommitted changes | "You have uncommitted changes. Commit with `/commit` or stash them first."                |
| PR state    | Not OPEN            | "PR is already {state}. Nothing to merge."                                                |
| Review      | Not APPROVED        | "PR requires approval. Current status: {reviewDecision}"                                  |
| Mergeable   | Not mergeable       | "PR cannot be merged. Status: {mergeStateStatus}. Check for conflicts or failing checks." |

If PR is already MERGED, skip to Step 4 (local cleanup only).

### Step 2: Confirm with User

Display the PR details and ask for confirmation:

```
Ready to merge PR #{number}: {title}

Branch: {headRefName} → main
Strategy: Squash merge
URL: {url}

Proceed with merge?
```

Use AskUserQuestion with options:

- "Yes, merge it" (proceed)
- "No, cancel" (abort)

### Step 3: Merge the PR

```bash
gh pr merge --squash --delete-branch
```

This command:

- Squash merges all commits into one
- Deletes the remote branch
- Handles the local branch deletion if possible

### Step 4: Local Cleanup

Save the branch name from Step 1, then:

```bash
# Switch to main
git checkout main

# Pull latest changes (includes the merged PR)
git pull origin main

# Delete local branch (use -D if -d fails due to unmerged state)
git branch -d {saved_branch_name}
```

If `git branch -d` fails with "not fully merged" warning (can happen with squash), use:

```bash
git branch -D {saved_branch_name}
```

### Step 5: Confirmation

Report success:

```
PR #{number} merged successfully.

- Remote branch deleted
- Local branch deleted
- Now on main with latest changes

View merged PR: {url}
```

## Error Recovery

**Merge failed mid-way:**

- If merge succeeded but checkout failed: Report merge success, guide user to manually run `git checkout main && git pull`
- If merge failed: Report the error from `gh pr merge`, do not proceed with cleanup

**Branch deletion failed:**

- Report success for merge, warn about manual branch cleanup needed
- Provide command: `git branch -D {branch_name}`
