---
name: implement-issue
description: Implement an approved plan. Reads plan from Linear, creates branch, and begins implementation.
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
- `--no-plan`: Skip plan file lookup and validation

If no issue ID provided:

```
Usage: /implement-issue HON-XX [--no-plan]
Examples:
  /implement-issue HON-51          # Normal flow with plan
  /implement-issue HON-51 --no-plan  # Skip planning for simple issues
```

### 2. Handle --no-plan mode

If `--no-plan` flag is present:

- Skip steps 3-5 (plan file handling)
- Fetch issue details directly
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

### 6. Update issue status

If current state is not "In Progress":

```
mcp__linear-server__update_issue({
  id: "HON-XX",
  state: "In Progress"
})
```

### 7. Assign to self

If issue is unassigned:

```
mcp__linear-server__update_issue({
  id: "HON-XX",
  assignee: "me"
})
```

If assigned to someone else, warn the user and ask before reassigning.

### 8. Create or switch to branch

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

### 9. Begin implementation

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

### 10. Signal completion

After implementing all steps, output the completion marker:

```
[implement-issue] ✓ Implementation complete for HON-XX
```

This marker signals to orchestrating skills (like `/auto-implement`) that implementation is finished and the next phase can proceed.

## Edge Cases

| Scenario                    | Handling                                            |
| --------------------------- | --------------------------------------------------- |
| Issue doesn't exist         | Error: "Issue HON-XX not found in Linear"           |
| Plan not in Linear comments | Offer to run `/plan-issue` or use `--no-plan`       |
| Plan is for different issue | Error: "Plan in comments is for HON-YY, not HON-XX" |
| Already on the branch       | Continue without creating new branch                |
| Assigned to someone else    | Warn and ask before reassigning                     |
| Not on main branch          | Warn if not on main when creating branch            |

## Important

- Always verify the branch name matches Linear's `gitBranchName`
- Don't update issue status after PR is created (Linear automation handles it)
- If implementation reveals plan issues, suggest updating the plan
