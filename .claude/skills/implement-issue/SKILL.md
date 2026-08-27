---
name: implement-issue
description: Implement an approved plan. Reads plan from Linear, creates branch, and begins implementation.
argument-hint: 'HON-XX [--no-plan]'
context: inherit
---

# Implement Issue

Execute an approved implementation plan and begin coding.

## Prerequisites

Requires an issue ID as argument (e.g., `/implement-issue HON-51`).

Supports optional `--no-plan` flag to skip plan validation for simple issues.

## Workflow

### 1. Parse arguments

Extract issue ID and check for flags:

- Issue ID: `HON-XX` or just `XX` (required)
- `--no-plan`: Skip plan lookup and validation (steps 4-5)

If no issue ID provided:

```
Usage: /implement-issue HON-XX [--no-plan]
Examples:
  /implement-issue HON-51          # Normal flow with plan
  /implement-issue HON-51 --no-plan  # Skip planning for simple issues
```

### 2. Handle --no-plan mode

If `--no-plan` flag is present:

- Still run step 3 — the fetch supplies `gitBranchName` and the status/blocker gate
- Skip steps 4-5 (plan lookup and validation)
- Use issue description as implementation guide
- Continue from step 6 (status update)

### 3. Fetch issue details

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract:

- Issue UUID (for API calls)
- `gitBranchName`
- Current state
- Current assignee
- `relations.blockedBy`

**Hard gate (runs in both normal and `--no-plan` mode) — stop before claiming the issue if either holds:**

- `status` is `Done`, `Canceled`, or `Duplicate` — the issue is already closed:

  ```
  HON-XX is [status] — nothing to implement. Pick another issue (`/next-issue`) or reopen it in Linear first.
  ```

- `relations.blockedBy` contains any issue whose status is not `Done` or `Canceled` — list the open blockers and stop:

  ```
  HON-XX is blocked by open issues:
    - HON-YY ([status]) — [title]
    - HON-ZZ ([status]) — [title]
  Finish the blockers first, or remove the relation in Linear if it is stale.
  ```

Do not proceed to step 4 (or step 6 in `--no-plan` mode) while either condition holds. Claiming a closed or blocked issue would put it back In Progress and hide the real dependency from `/next-issue`.

### 4. Find plan from Linear comments

```
mcp__linear-server__list_comments({ issueId: "issue-uuid" })
```

Look for a comment starting with `# Plan:` - this is the plan posted by `/plan-issue`.

If no plan comment found:

```
No plan found for HON-XX in Linear comments.

Options:
1. Run `/plan-issue HON-XX` to create and post a plan first
2. Run `/implement-issue HON-XX --no-plan` to skip planning
```

### 5. Validate plan

Verify the plan comment:

- Contains implementation steps
- Contains files to create/modify
- Issue ID in plan matches the requested issue

Store the plan content for implementation guidance.

### 6. Update issue status and assign to self

If assigned to someone else, warn the user and ask before reassigning.

If current state is not "In Progress" or the issue is unassigned, claim it in a single call:

```
mcp__linear-server__save_issue({
  id: "HON-XX",
  state: "In Progress",
  assignee: "me"
})
```

### 7. Create or switch to branch

First, detect if we're in a worktree:

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

If outputs differ → **worktree mode**
If outputs same → **regular repo mode**

**Worktree mode:**

In a worktree, the branch is already set by the worktree itself. We work directly on it:

```bash
# Just verify the current branch
git branch --show-current
```

The worktree branch becomes the working branch. Skip branch creation/switching.

**Regular repo mode:**

Check if branch already exists:

```bash
git branch --list "[gitBranchName]"
```

If branch exists:

```bash
git checkout [gitBranchName]
```

If branch doesn't exist:

```bash
git checkout -b [gitBranchName]
```

Verify you're on the correct branch:

```bash
git branch --show-current
```

### 8. Begin implementation

CLAUDE.md is already loaded as project instructions — do not re-read it. Read `docs/TYPOGRAPHY.md` only if the issue involves typography components.

Inform the user that setup is complete:

```
Ready to implement HON-XX: [Issue Title]

Branch: [gitBranchName]
Plan posted to Linear: [Yes/No/Skipped]
Status: In Progress

Implementation steps from plan:
1. [Step 1]
2. [Step 2]
...

Starting with step 1...
```

Then implement following the plan steps (or issue description if `--no-plan`).

### 9. Signal completion

After implementing all steps, output the completion marker exactly as shown:

```
[implement-issue:complete] Implementation complete for HON-XX
```

This marker signals to orchestrating skills (like `/auto-implement`) that implementation is finished. The calling context will determine what happens next.

## Edge Cases

| Scenario                    | Handling                                            |
| --------------------------- | --------------------------------------------------- |
| Issue doesn't exist         | Error: "Issue HON-XX not found in Linear"           |
| Issue Done/Canceled/Dup.    | Stop at step 3 gate; do not claim                   |
| Has open blockers           | Stop at step 3 gate; list blockers                  |
| Plan not in Linear comments | Offer to run `/plan-issue` or use `--no-plan`       |
| Plan is for different issue | Error: "Plan in comments is for HON-YY, not HON-XX" |
| Already on the branch       | Continue without creating new branch                |
| Assigned to someone else    | Warn and ask before reassigning                     |
| In worktree                 | Use worktree branch directly, skip branch creation  |
| Not on main (regular repo)  | Warn if not on main when creating branch            |

## Important

- Always verify the branch name matches Linear's `gitBranchName`
- Don't update issue status after PR is created (Linear automation handles it)
- If implementation reveals plan issues, suggest updating the plan
