---
name: next-issue
description: Find the next unblocked Linear issue to work on. Use when user says "continue implementation" or asks what to work on next.
context: fork
agent: general-purpose
allowed-tools:
  - mcp__linear-server__list_issues
  - mcp__linear-server__get_issue
  - Read
  - Grep
  - Glob
---

# Next Issue Finder

Find the next unblocked issue and return a concise implementation summary.

## Workflow

1. **Read project context**

   ```
   Read docs/PROJECT_SPEC.md
   ```

   Review for current phase and relevant context.

2. **Search for issues (priority order)**

   Search in this order, stopping when unblocked issues are found:

   **a) Todo/Active issues (highest priority):**

   ```
   mcp__linear-server__list_issues({
     project: "5a19627a-803f-4052-83c4-b44810d17af7",
     state: "Todo",
     limit: 20
   })
   ```

   **b) Backlog issues:**

   ```
   mcp__linear-server__list_issues({
     project: "5a19627a-803f-4052-83c4-b44810d17af7",
     state: "Backlog",
     limit: 20
   })
   ```

3. **Check dependencies for candidate issues**
   For each promising issue, fetch with relations:

   ```
   mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
   ```

4. **Find unblocked issues**
   An issue is unblocked if:
   - `blockedBy` is empty, OR
   - All issues in `blockedBy` have status "Done" or "Canceled"

5. **Prioritize by**
   - Status: Todo/Active before Backlog
   - Dependency order (issues that unblock others first - check `blocks` array)
   - Priority field if set

6. **Quick codebase scan**
   Read key files mentioned in the issue description to identify:
   - Files to modify
   - Existing patterns to follow
     Only read 2-3 most relevant files, not the entire codebase.

## Output Format

Return up to 3 unblocked candidates, ranked by priority. Keep total output under 600 words.

```
## Top Candidates

### 1. HON-XX - [Title]
**Why:** Unblocks HON-YY, HON-ZZ | [Brief rationale]
**Files:** `file1.ts`, `file2.ts`
**Summary:** [1-2 sentences]

### 2. HON-AA - [Title]
**Why:** [Brief rationale]
**Files:** `file1.ts`, `file2.ts`
**Summary:** [1-2 sentences]

### 3. HON-BB - [Title]
**Why:** [Brief rationale]
**Files:** `file1.ts`, `file2.ts`
**Summary:** [1-2 sentences]

---

## Parallel Commands

Run in separate terminals for parallel implementation:

\`\`\`bash
wt auto [gitBranchName-1]
wt auto [gitBranchName-2]
wt auto [gitBranchName-3]
\`\`\`
```

The "Parallel Commands" section provides ready-to-copy commands using the `gitBranchName` from Linear. Each command creates a worktree and runs autonomous implementation.

If fewer than 3 unblocked issues exist, return only what's available.

## Completion

After outputting candidates, add the marker:

```
[next-issue:complete] Found N candidates: HON-XX, HON-AA, HON-BB
```

If no unblocked issues found:

```
[next-issue:complete] No unblocked issues found
```

## Important

- Return up to 3 candidates to enable parallel worktree sessions
- Do NOT explore the entire codebase - only files directly relevant to each issue
- Keep each candidate summary brief - main agent will do detailed planning
- Prioritize issues that unblock others
- Always include the `gitBranchName` from Linear in the parallel commands
- The `wt auto` command accepts branch names and extracts the issue ID automatically
