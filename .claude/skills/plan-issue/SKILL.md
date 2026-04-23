---
name: plan-issue
description: Create an implementation plan for a Linear issue. Explores codebase, writes plan, posts to Linear after approval.
context: inherit
---

# Plan Issue

Create a comprehensive implementation plan for a Linear issue.

## Prerequisites

Requires an issue ID as argument (e.g., `/plan-issue HON-51`).

Supports optional `--auto` flag to skip approval prompt (used by `/auto-implement`).

## Workflow

### 1. Parse arguments

Extract issue ID and flags from arguments:

- Issue ID: `HON-XX` or just `XX` (required)
- `--auto`: Skip approval prompt and post directly

If no issue ID provided, inform the user:

```
Usage: /plan-issue HON-XX [--auto]
Example: /plan-issue HON-51
```

### 2. Fetch issue details

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract and note:

- Issue UUID (for API calls in steps 4 and 8)
- Title and description
- `gitBranchName` for later use
- `blockedBy` relations (check if blocked)
- `blocks` relations (what this unblocks)
- `relatedTo` / `parentId` (for overlap check in step 3)
- Any labels or priority

**If issue is blocked:** Warn the user and list the blocking issues. Ask if they want to proceed anyway or work on the blockers first.

### 3. Check relatedTo + epic siblings for recently-merged overlap

**Why:** When an issue is part of an epic (has `parentId`) or has `relatedTo` links, a sibling issue may have already landed and introduced files, conventions, schema, or constants that your plan needs to build on rather than duplicate. `blockedBy` is checked above; `relatedTo` and epic-siblings are not — a Done sibling in the same epic is a strong "check for overlap" signal.

Before doing anything else, sync with origin so the overlap check sees the current main:

```bash
git fetch origin main
```

For each id in `relations.relatedTo` and (if `parentId` is set) each sub-issue of the parent:

```
mcp__linear-server__get_issue({ id: "HON-YY", includeRelations: true })
```

For any sibling where `status` ∈ { `Done`, `In Review`, `In Progress` }:

- Note its title, `gitBranchName`, and completion/start time.
- If status is `Done` AND `completedAt` is within the last 14 days, fetch the merged PR to see what files it touched:
  ```bash
  gh pr list --search "HON-YY in:title" --state merged --json number,title,files,mergedAt --limit 1
  ```
  Inspect the `files` array. If any overlap with files you expect to modify (schema, shared lib, route files), flag it in the plan's **Design Decisions** and adjust the approach (extend rather than duplicate).
- If status is `In Progress` / `In Review`, surface it as a coordination risk in the plan's context.

Report the finding to the user inline before continuing so they can redirect if the overlap changes scope:

```
[plan-issue] Sibling check: HON-YY (Done, merged PR #<N> <date>) touches <files> — plan will extend, not duplicate.
```

If no siblings match, log one line and continue:

```
[plan-issue] Sibling check: no recently-merged/in-flight related issues.
```

### 4. Read project context

```
Read docs/PROJECT_SPEC.md
```

Note the current phase and any relevant architectural decisions.

### 5. Fetch issue comments

```
mcp__linear-server__list_comments({ issueId: "issue-uuid" })
```

Review any prior discussion, decisions, or context from team members.

### 6. Explore codebase

Using Read, Grep, and Glob tools:

- Identify key files mentioned in the issue
- Find existing patterns to follow
- Note related components or APIs

Focus on files directly relevant to the issue (2-5 files max).

**If step 3 flagged any recently-merged sibling issues:** also run `git log --oneline --since="14 days ago" -- <overlapping-paths>` and `git diff origin/main~<N>..origin/main -- <overlapping-paths>` so you actually see what the sibling changed. The file tree alone doesn't tell you which lines are new; without the diff you risk searching for a pattern, not finding it, and duplicating it.

### 7. Write plan and present to user

Write the plan directly in your response (not to a file). Use this structure:

```markdown
# Plan: HON-XX - [Issue Title]

**Issue:** HON-XX
**Branch:** `[gitBranchName from Linear]`

## Context

[2-3 sentence summary of the issue and relevant background]

## Design Decisions

| Decision       | Choice        | Rationale |
| -------------- | ------------- | --------- |
| [Key decision] | [Your choice] | [Why]     |

## Files to Create

- `src/path/to/new/file.tsx` - [Purpose]

## Files to Modify

- `src/path/to/existing/file.ts` - [What changes]

## Implementation Steps

1. [Specific step with details]
2. [Specific step with details]
3. [Specific step with details]

## Tests

- `src/path/to/file.test.ts` - [What to test]

## Verification

- [ ] [How to test the implementation]
- [ ] [What to verify works correctly]
- [ ] [Edge cases to check]
```

### 8. Get approval (or skip if --auto)

**If `--auto` flag is present:** Skip approval and proceed directly to step 9.

**Otherwise:** Use `AskUserQuestion` to confirm the plan:

```
AskUserQuestion({
  questions: [{
    question: "Does this plan look good to post to Linear?",
    header: "Plan review",
    options: [
      { label: "Yes, post to Linear", description: "Approve the plan and post it as a comment on the issue" },
      { label: "No, needs changes", description: "I'll provide feedback on what to adjust" }
    ],
    multiSelect: false
  }]
})
```

If the user wants changes, revise the plan and ask again.

### 9. Post plan to Linear

Once approved, post the plan you wrote in step 7 to Linear:

```
mcp__linear-server__create_comment({
  issueId: "issue-uuid",
  body: "[The complete plan from step 7, including the markdown structure]"
})
```

### 10. Move issue to In Progress

Update the issue status so other auto-implement sessions won't pick it up:

```
mcp__linear-server__update_issue({
  id: "HON-XX",
  state: "In Progress"
})
```

### 11. Output completion

Output the completion marker:

```
[plan-issue:complete] Plan posted to HON-XX
```

**If `--auto` flag was NOT used:** Also output:

```
Run `/implement-issue HON-XX` when ready to start implementation.
```

Then STOP. Do not proceed to implementation, do not offer next steps, do not ask questions.

**If `--auto` flag WAS used:** Do NOT output the "Run /implement-issue" message. Just output the completion marker. The orchestrating skill (auto-implement) will handle the next step.

## Important

- Include the issue ID in the plan header (required for `/implement-issue` validation)
- Include the `gitBranchName` from Linear
- Be specific about file paths (use absolute paths from project root)
- Order implementation steps by dependency
- Include verification steps that can be checked after implementation
- If the issue has acceptance criteria, map them to verification steps
- **Never suggest or prompt to start implementation** - the skill ends after posting to Linear
