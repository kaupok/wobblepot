---
name: implement-issue
description: Implement an approved plan. Posts plan to Linear, creates branch, and begins implementation.
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

### 3. Find plan file

Look for recent plan files in `~/.claude/plans/` that contain the issue ID.

Search pattern: Look for files containing `**Issue:** HON-XX` or `# Plan: HON-XX`.

```bash
grep -l "HON-XX" ~/.claude/plans/*.md 2>/dev/null | head -1
```

If no matching plan file found:
```
No plan found for HON-XX.

Options:
1. Run `/plan-issue HON-XX` to create a plan first
2. Run `/implement-issue HON-XX --no-plan` to skip planning
```

### 4. Read and validate plan

Read the plan file and verify:
- Issue ID in header matches the requested issue
- Plan has implementation steps
- Plan has files to create/modify

Store the plan content for posting to Linear.

### 5. Fetch issue details

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract:
- Issue UUID (for API calls)
- `gitBranchName`
- Current state
- Current assignee

### 6. Post plan to Linear (skip if --no-plan)

First, check if plan was already posted:
```
mcp__linear-server__list_comments({ issueId: "issue-uuid" })
```

If no comment starts with "# Plan:", post the plan:
```
mcp__linear-server__create_comment({
  issueId: "issue-uuid",
  body: "[Full plan content from plan file]"
})
```

### 7. Update issue status

If current state is not "In Progress":
```
mcp__linear-server__update_issue({
  id: "HON-XX",
  state: "In Progress"
})
```

### 8. Assign to self

If issue is unassigned:
```
mcp__linear-server__update_issue({
  id: "HON-XX",
  assignee: "me"
})
```

If assigned to someone else, warn the user and ask before reassigning.

### 9. Create or switch to branch

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

### 10. Begin implementation

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

Then begin implementing following the plan steps (or issue description if `--no-plan`).

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Issue doesn't exist | Error: "Issue HON-XX not found in Linear" |
| Plan file not found | Offer to run `/plan-issue` or use `--no-plan` |
| Plan is for different issue | Error: "Plan file is for HON-YY, not HON-XX" |
| Already on the branch | Continue without creating new branch |
| Assigned to someone else | Warn and ask before reassigning |
| Plan already posted | Skip posting, note "Plan already in Linear" |
| Not on main branch | Warn if not on main when creating branch |

## Important

- Always verify the branch name matches Linear's `gitBranchName`
- Don't update issue status after PR is created (Linear automation handles it)
- Post the full plan to Linear, not a summary
- If implementation reveals plan issues, suggest updating the plan
