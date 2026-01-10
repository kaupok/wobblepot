---
name: pr-review
description: Review changes on the current branch. Use when user wants a code review before creating a PR.
context: fork
agent: general-purpose
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# PR Review

Review changes on the current branch and provide structured feedback.

## Workflow

1. **Verify branch state**
   ```bash
   git branch --show-current
   ```
   If on `main`, report error and stop.

2. **Get changed files**
   ```bash
   git diff --name-only origin/main...HEAD
   ```

3. **Get the diff (committed changes)**
   ```bash
   git diff origin/main...HEAD
   ```

4. **Get staged changes (not yet committed)**
   ```bash
   git diff --cached
   ```
   Include these in the review as they will be part of the next commit.

5. **Read changed files for full context**
   Use the Read tool to read each changed file to understand the full context.

6. **Read CLAUDE.md for project patterns**
   Use the Read tool on CLAUDE.md. Focus on: Code Standards, Typography Components, Authentication Patterns, Database Patterns, Testing sections.

7. **Review the changes for:**
   - **Bugs**: Logic errors, edge cases, null/undefined handling
   - **Security**: Injection risks, auth bypasses, sensitive data exposure
   - **Patterns**: Adherence to CLAUDE.md conventions (sentence case, typography components, etc.)
   - **TypeScript**: Type safety, any types, missing types
   - **Tests**: Missing test coverage for new functionality
   - **Performance**: N+1 queries, unnecessary re-renders, large bundle imports

## Output Format

Return a structured review (under 800 words):

```
## PR Review: [branch-name]

### Summary
[2-3 sentence summary of what this PR does]

### Changes
- `path/to/file.ts` - [brief description]
- `path/to/file2.ts` - [brief description]

### Issues

#### 🔴 Critical
- [Issue description with file:line reference]

#### 🟡 Suggestions
- [Improvement suggestion with file:line reference]

#### 🟢 Nitpicks
- [Minor issues, style nits]

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
