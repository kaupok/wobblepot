---
name: branch-review
description: Review all code changes on the current branch (committed, staged, unstaged, untracked) with PR and Linear issue context, then triage into actionable categories. This is the project's full branch-review + triage flow; distinct from the built-in /code-review (diff bug/cleanup review with --fix/--comment/ultra).
context: fork
agent: general-purpose
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - mcp__linear-server__get_issue
  - mcp__linear-server__list_comments
---

# Branch review

Review all changes on the current branch, provide structured feedback, and triage issues into actionable categories.

Supports optional `--quick` flag to skip external context fetching (PR/Linear).

## Workflow

### 1. Parse arguments

Check if `--quick` flag was passed. If so, skip steps 5 and 6 (external context).

### 2. Verify branch state

```bash
git branch --show-current
```

If on `main`, report error and stop.

### 3. Get all changed files

Collect changes from all four sources:

```bash
# Committed changes (vs main)
git diff --name-only origin/main...HEAD

# Staged but uncommitted
git diff --cached --name-only

# Unstaged (working directory changes to tracked files)
git diff --name-only

# Untracked files (new files not yet added to git)
git ls-files --others --exclude-standard
```

Deduplicate the file list (same file may appear in multiple categories).

If all four sources return empty (no changes detected), report "No changes detected on this branch" and stop.

### 4. Get the diffs and file contents

```bash
# Committed changes
git diff origin/main...HEAD

# Staged changes
git diff --cached

# Unstaged changes
git diff
```

For untracked files, use the Read tool to read the full file contents (no diff available).

Track which files have changes in each category for the summary.

### 5. Get PR context (skip if --quick)

Check if a PR exists for the current branch:

```bash
gh pr view --json title,body,url 2>/dev/null
```

If PR exists, note the title, description, and URL for context. If the PR description mentions specific concerns or areas to review, prioritize those.

### 6. Get Linear issue context (skip if --quick)

Extract issue ID from branch name:

```bash
git branch --show-current | grep -oiE 'hon-[0-9]+' | head -1
```

If an issue ID is found (e.g., `HON-11`):

**6a. Fetch issue details:**

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Note the issue title, description, and any acceptance criteria.

**6b. Fetch implementation plan from comments:**

```
mcp__linear-server__list_comments({ issueId: "[issue-uuid-from-step-6a]" })
```

Look for a comment that starts with `# Plan:` - this is the implementation plan posted by `/implement-issue`.

If a plan is found:

- Note the planned implementation steps
- Compare actual implementation to planned approach
- Check if all planned files were modified
- Verify planned verification steps are addressed

**6c. Use context in review:**

- Check if the changes address the issue requirements
- If plan exists, verify implementation matches planned approach
- Note any deviations from the plan (not necessarily bad, but worth mentioning)

### 7. Read changed files for full context

Use the Read tool to read each changed file to understand the full context.

### 8. Review the changes for:

CLAUDE.md is already loaded as project instructions — do not re-read it. Read `docs/TYPOGRAPHY.md` only if the changes involve typography components.

- **Bugs**: Logic errors, edge cases, null/undefined handling
- **Security**: Injection risks, auth bypasses, sensitive data exposure
- **Patterns**: Adherence to CLAUDE.md conventions (sentence case, typography components, etc.)
- **TypeScript**: Type safety, any types, missing types
- **Tests**: Missing test coverage for new functionality
- **Performance**: N+1 queries, unnecessary re-renders, large bundle imports
- **Requirements**: If Linear issue context available, verify acceptance criteria are met
- **Plan Compliance**: If implementation plan found, verify implementation matches planned approach
- **E2E drift**: If the diff includes `src/app/**/page.tsx`, a modal/dialog component, or changes user-visible copy in a heading/button/link, grep `tests/e2e/` for stale references to the old identifiers. Spec-file `// ROUTES: … · COMPONENTS: …` headers make this a deterministic scan:

  ```bash
  # For a route change (e.g. removed /settings/invites):
  grep -l "ROUTES.*<route>" tests/e2e/*.spec.ts

  # For a component rename (e.g. MealDetailModal → MealDetail):
  grep -l "COMPONENTS.*<OldName>" tests/e2e/*.spec.ts

  # For a copy rename — also grep spec bodies:
  grep -rn "<exact old copy>" tests/e2e/
  ```

  If any spec references removed routes or renamed copy, call it out in **Address Now** — stale specs are cheap to miss locally and land as a CI regression. See HON-518 for the drift-batch incident this rule was introduced to prevent.

### 9. Triage issues

After identifying all issues, triage each one using **effort-first** thinking:

**Effort** (primary factor):

- Quick fix (few lines, < 5 min) → **address now**, regardless of severity
- Moderate fix (15-30 min, in scope) → **address now**
- Significant work (new feature, major refactor) → defer only if truly out of scope

**Severity** (secondary factor):

- 🔴 Critical → always address now, regardless of effort
- 🟡 Suggestion → address if quick or moderate effort
- 🟢 Nitpick → address if quick fix, otherwise skip

**Bias toward action.** Deferred items rarely get done. If something can be fixed in a few minutes, just fix it.

Place each item in one of three buckets:

- **Address Now**: Fix before PR merge. Includes all quick fixes and anything critical.
- **Defer**: Only for significant work (hours, not minutes) that's genuinely out of scope. Must justify why.
- **Skip**: Disagree with the suggestion or it's not actionable. Explain why.

## Output Format

Return a structured review with triage (under 1000 words):

```
## Branch review: [branch-name]

### Context
- **PR**: [title](url) or "No PR created"
- **Issue**: [HON-XX: title] or "No linked issue"
- **Plan**: Found in Linear comments / Not found

### Changes Summary
- **Committed** (vs main): X files
- **Staged**: X files
- **Unstaged**: X files
- **Untracked**: X files

Files: `file1.ts`, `file2.ts`, ...

### Requirements Check
[If Linear issue available: List acceptance criteria and whether they're addressed]
[If no issue: Skip this section]

### Plan Compliance
[If implementation plan found in comments:]
- Planned files vs actual files modified
- Any deviations from planned approach
[If no plan: Skip this section]

### Triage

#### Address Now
1. [🔴/🟡/🟢] [Issue description] - `file:line` - [effort: quick/moderate]
2. ...

#### Defer
1. [Issue description] - [Why it's out of scope]
   → **Create issue:** [Proposed Linear issue title]
2. ...
(If empty: "None")

**Note:** For each deferred item, propose a specific Linear issue to create. After review is complete, offer to create these issues.

#### Skip
1. [Issue description] - [Why disagreed or not actionable]
2. ...
(If empty: "None")

### Missing Tests
- [ ] [Test case that should be added]

### Pre-merge Checklist
- [ ] `pnpm lint` passes
- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes
- [ ] If changes touch `src/app/**/page.tsx`, a modal/dialog component, or user-visible copy: grepped `tests/e2e/` `// ROUTES: …` / `// COMPONENTS: …` headers for stale references and updated affected specs (or noted "no E2E impact")
- [ ] PR description is up to date

### Verdict
[APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION] - [one sentence rationale]

### Next Steps
1. Fix [specific item] in `file:line`
2. Fix [specific item] in `file:line`
3. Run `/commit` when done

### Deferred Issues to Create
[If any items were deferred, list proposed Linear issues here:]
- [ ] [Issue title] - [Brief description]
```

## Completion

After outputting the review, add the completion marker:

```
[branch-review:complete] Review finished - [APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION]
```

## Important

- Be specific - include file paths and line numbers
- Prioritize actionable feedback over praise
- If no issues found, say "No issues found" and verdict APPROVE
- Focus on the diff, not unrelated code
- Check for patterns from CLAUDE.md (sentence case, typography components, etc.)
- If Linear issue has acceptance criteria, verify they're addressed in the review
- **Bias toward action** - when in doubt, put it in Address Now
- **Defer is last resort** - only for work that genuinely takes hours and is out of scope
