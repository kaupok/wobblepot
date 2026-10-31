---
name: next-issue
description: Find the next unblocked Linear issue to work on. Use when the user asks what to work on next or says 'continue implementation'.
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

Arguments: $ARGUMENTS

Find the next unblocked, unclaimed issue and return a concise implementation summary.

**This skill proposes; it writes no state.** It runs in a fork without `save_issue`. Its output is a list of candidates. It lists Backlog and Todo while `/auto-implement` auto-discovery (its step 1.2) lists Queued only, because finding ready work in the backlog is this skill's purpose. Mark each candidate an agent can finish alone as ready to queue. The calling session then offers to move those to Queued and moves the ones the user accepts (CLAUDE.md → File and queue by default).

## Workflow

1. **Read project context**

   ```
   Read docs/PROJECT_SPEC.md
   ```

   Review for current phase and relevant context.

2. **List Queued issues, and unassigned Todo and Backlog issues**

   Pass `assignee: "null"` for Todo and Backlog, because those are for humans and an assignee has claimed them. Queued takes no assignee filter: an agent may take a Queued issue whatever its assignee (HON-1483). Never list all issues and filter client-side. Never list issues with any other state (In Progress / In Review / Done / Canceled issues are already claimed or complete).

   The three states mean different things: **Todo** is work a human intends to do, **Queued** is the orchestrator's unattended queue (a human who takes a queued issue by hand moves it out of Queued), and **Backlog** is everything not yet promoted. List them in this order, and step 5 ranks in the same order:

   ```
   mcp__linear-server__list_issues({ state: "Todo",    assignee: "null", limit: 100 })
   mcp__linear-server__list_issues({ state: "Queued",  limit: 100 })
   mcp__linear-server__list_issues({ state: "Backlog", assignee: "null", limit: 100 })
   ```

3. **Verify every candidate with `includeRelations: true`**

   Before a candidate can enter the output list, re-fetch it:

   ```
   mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
   ```

   `list_issues` does not return the `relations` field, so blockers are invisible without this step.

4. **Hard filters — reject the candidate if ANY of these fail**

   - `status` must be one of: `Todo`, `Queued`, `Backlog`. Reject `In Progress`, `In Review`, `Done`, `Canceled`, `Triage`.
   - For `Todo` and `Backlog`, `assignee` must be `null`. Reject any such issue with an assignee, even "me" — it's already claimed. A `Queued` issue passes whatever its assignee.
   - Every id in `relations.blockedBy` must resolve to a `status` of `Done` or `Canceled`. An empty `blockedBy` array passes. An open blocker (Backlog / Todo / Queued / In Progress / In Review) fails.
   - `statusType` must not be `triage` or `canceled`.

   If any filter rejects the candidate, discard it and pick another — **do not downgrade the candidate to a "caveat" or include it anyway**. Silent failures here are the primary failure mode this skill exists to prevent.

5. **Prioritize surviving candidates**
   - State, in the step 2 order: Todo → Queued → Backlog
   - Issues that unblock others (large `blocks` array) before leaf issues
   - Higher priority (lower `priority.value`) before lower

6. **Quick codebase scan**
   Read key files mentioned in the issue description to identify:
   - Files to modify
   - Existing patterns to follow
     Read the files the candidate depends on, not the entire codebase.

## Output Format

Return up to 3 unblocked candidates, ranked by priority.

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

After outputting candidates, emit the completion marker:

```
[next-issue:complete] Found N candidates: HON-XX, HON-AA, HON-BB
```

If no unblocked issues survive the filters:

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
- **Every returned candidate must have passed step 4's hard filters via a `get_issue` call with `includeRelations: true`.** Never surface a candidate based on `list_issues` output alone — that endpoint hides `relations` and can disagree with the prose "Blocked by" section. If fewer than 3 candidates survive the filters, return only what survives; do not pad the list.
