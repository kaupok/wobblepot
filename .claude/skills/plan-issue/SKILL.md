---
name: plan-issue
description: Create an implementation plan for a Linear issue. Enter plan mode and write a detailed plan.
context: inherit
---

# Plan Issue

Create a comprehensive implementation plan for a Linear issue.

## Prerequisites

Requires an issue ID as argument (e.g., `/plan-issue HON-51`).

## Workflow

### 1. Parse issue ID

Extract issue ID from arguments. Format: `HON-XX` or just `XX`.

If no issue ID provided, inform the user:
```
Usage: /plan-issue HON-XX
Example: /plan-issue HON-51
```

### 2. Fetch issue details

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract and note:
- Title and description
- `gitBranchName` for later use
- `blockedBy` relations (check if blocked)
- `blocks` relations (what this unblocks)
- Any labels or priority

**If issue is blocked:** Warn the user and list the blocking issues. Ask if they want to proceed anyway or work on the blockers first.

### 3. Fetch project context

```
mcp__linear-server__get_project({ query: "5a19627a-803f-4052-83c4-b44810d17af7" })
```

Note the current phase, active milestone, and any relevant architectural decisions.

### 4. Fetch issue comments

```
mcp__linear-server__list_comments({ issueId: "issue-uuid" })
```

Review any prior discussion, decisions, or context from team members.

### 5. Explore codebase

Using Read, Grep, and Glob tools:
- Identify key files mentioned in the issue
- Find existing patterns to follow
- Note related components or APIs

Focus on files directly relevant to the issue (2-5 files max).

### 6. Enter plan mode

If not already in plan mode, use `EnterPlanMode` to enter it.

### 7. Write plan file

Create a plan file with this structure:

```markdown
# Plan: HON-XX - [Issue Title]

**Issue:** HON-XX
**Branch:** `[gitBranchName from Linear]`

## Context

[2-3 sentence summary of the issue and relevant background]

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| [Key decision] | [Your choice] | [Why] |

## Files to Create

- `src/path/to/new/file.tsx` - [Purpose]

## Files to Modify

- `src/path/to/existing/file.ts` - [What changes]

## Implementation Steps

1. [Specific step with details]
2. [Specific step with details]
3. [Specific step with details]

## Verification

- [ ] [How to test the implementation]
- [ ] [What to verify works correctly]
- [ ] [Edge cases to check]
```

### 8. Request plan approval

Call `ExitPlanMode` to request user approval of the plan.

### 9. Post plan to Linear (after approval)

Once the user approves the plan, fetch the issue UUID and post the plan:

```
mcp__linear-server__get_issue({ id: "HON-XX" })
```

Extract the issue UUID, then post:

```
mcp__linear-server__create_comment({
  issueId: "issue-uuid",
  body: "[Full plan content from plan file]"
})
```

### 10. Output completion and STOP

Output exactly this (substituting actual values):

```
✓ Plan approved and posted to HON-XX.

Run `/implement-issue HON-XX` when ready to start implementation.
```

**STOP HERE.** Do not proceed to implementation, do not offer next steps, do not ask questions. The skill is complete.

## Important

- Include the issue ID in the plan header (required for `/implement-issue` validation)
- Include the `gitBranchName` from Linear
- Be specific about file paths (use absolute paths from project root)
- Order implementation steps by dependency
- Include verification steps that can be checked after implementation
- If the issue has acceptance criteria, map them to verification steps
- **Never suggest or prompt to start implementation** - the skill ends after plan approval
