---
name: next-issue
description: Find the next unblocked Linear issue to work on. Use when user says "continue implementation" or asks what to work on next.
context: fork
agent: general-purpose
allowed-tools:
  - mcp__linear-server__get_project
  - mcp__linear-server__list_issues
  - mcp__linear-server__get_issue
  - Read
  - Grep
  - Glob
---

# Next Issue Finder

Find the next unblocked issue in the active milestone and return a concise implementation summary.

## Workflow

1. **Fetch project context**

   ```
   mcp__linear-server__get_project({ query: "5a19627a-803f-4052-83c4-b44810d17af7" })
   ```

   Extract: Active milestone name from the project description (look for "**Active Milestone:**")

2. **List backlog issues in active milestone**

   ```
   mcp__linear-server__list_issues({
     project: "5a19627a-803f-4052-83c4-b44810d17af7",
     state: "Backlog",
     limit: 20
   })
   ```

3. **Check dependencies for milestone issues**
   For each issue in the active milestone (check `projectMilestone.name`), fetch with relations:

   ```
   mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
   ```

4. **Find unblocked issues**
   An issue is unblocked if:
   - `blockedBy` is empty, OR
   - All issues in `blockedBy` have status "Done" or "Canceled"

5. **Prioritize by**
   - Dependency order (issues that unblock others first - check `blocks` array)
   - Logical sequence within milestone

6. **Quick codebase scan**
   Read key files mentioned in the issue description to identify:
   - Files to modify
   - Existing patterns to follow
     Only read 2-3 most relevant files, not the entire codebase.

## Output Format

Return a concise summary (under 500 words):

```
## Recommended: HON-XX - [Title]

**Why this issue:**
- Unblocked (no dependencies / dependencies complete)
- Unblocks: HON-YY, HON-ZZ

**Summary:**
[2-3 sentence description of what to implement]

**Key files:**
- `path/to/file.ts` - [what to modify]
- `path/to/file2.ts` - [what to modify]

**Implementation approach:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Git branch:** `[gitBranchName from Linear]`
```

## Completion

After outputting the recommendation, add the marker:

```
[next-issue:complete] Recommended HON-XX
```

If no unblocked issues found:

```
[next-issue:complete] No unblocked issues found
```

## Important

- Do NOT explore the entire codebase - only files directly relevant to the issue
- Keep output concise - main agent will do detailed planning
- If multiple issues are unblocked, recommend the one that unblocks the most others
- Always include the `gitBranchName` from Linear for easy branch creation
