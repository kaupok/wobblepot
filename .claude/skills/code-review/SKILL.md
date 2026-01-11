---
name: code-review
description: Review all code changes on the current branch (committed, staged, unstaged, untracked). Pulls in PR and Linear issue context when available.
context: fork
agent: general-purpose
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - mcp__linear-server__get_issue
---

# Code Review

Review all changes on the current branch and provide structured feedback.

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

If an issue ID is found (e.g., `HON-11`), fetch the issue details:

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Note the issue title, description, and any acceptance criteria. Check if the changes address the issue requirements.

### 7. Read changed files for full context

Use the Read tool to read each changed file to understand the full context.

### 8. Read CLAUDE.md for project patterns

Use the Read tool on CLAUDE.md. Focus on: Code Standards, Typography Components, Authentication Patterns, Database Patterns, Testing sections.

### 9. Review the changes for:

- **Bugs**: Logic errors, edge cases, null/undefined handling
- **Security**: Injection risks, auth bypasses, sensitive data exposure
- **Patterns**: Adherence to CLAUDE.md conventions (sentence case, typography components, etc.)
- **TypeScript**: Type safety, any types, missing types
- **Tests**: Missing test coverage for new functionality
- **Performance**: N+1 queries, unnecessary re-renders, large bundle imports
- **Requirements**: If Linear issue context available, verify acceptance criteria are met

## Output Format

Return a structured review (under 800 words):

```
## Code Review: [branch-name]

### Context
- **PR**: [title](url) or "No PR created"
- **Issue**: [HON-XX: title] or "No linked issue"

### Changes Detected
- **Committed** (vs main): X files
- **Staged**: X files
- **Unstaged**: X files
- **Untracked**: X files

### Files Changed
- `path/to/file.ts` - [brief description]
- `path/to/file2.ts` - [brief description]

### Issues

#### 🔴 Critical
- [Issue description with file:line reference]

#### 🟡 Suggestions
- [Improvement suggestion with file:line reference]

#### 🟢 Nitpicks
- [Minor issues, style nits]

### Requirements Check
[If Linear issue available: List acceptance criteria and whether they're addressed]
[If no issue: Skip this section]

### Missing Tests
- [ ] [Test case that should be added]

### Pre-merge Checklist
- [ ] `pnpm lint` passes
- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes
- [ ] PR description is up to date

### Verdict
[APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION] - [one sentence rationale]
```

## Important

- Be specific - include file paths and line numbers
- Prioritize actionable feedback over praise
- If no issues found, say so clearly
- Focus on the diff, not unrelated code
- Check for patterns from CLAUDE.md (sentence case, typography components, etc.)
- If Linear issue has acceptance criteria, verify they're addressed in the review
- If PR description mentions specific concerns, prioritize reviewing those areas
