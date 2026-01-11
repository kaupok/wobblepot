---
name: commit
description: Create a commit following project conventions. Stages changes, runs checks, and commits with proper message format.
context: inherit
---

# Commit

Create a well-formatted commit following project conventions.

## Workflow

### 1. Verify branch

```bash
git branch --show-current
```

If on `main`, stop and inform the user to create a feature branch first.

### 2. Check for changes

```bash
git status
git diff --stat
git diff --cached --stat
```

If no changes (staged or unstaged), inform the user and stop.

### 3. Review conventions

Read `docs/GIT_WORKFLOW.md` for:
- Pre-commit checklist
- Commit message format
- HEREDOC syntax for commit messages

Read `CLAUDE.md` section "Commit Message Conventions" for:
- Type prefixes (feat, fix, docs, etc.)
- Scope usage
- Subject line formatting

### 4. Stage changes

```bash
git add -A
git status
```

Review what will be committed. If there are files that shouldn't be committed (secrets, generated files, etc.), warn the user.

### 5. Run pre-commit checks

```bash
pnpm lint && pnpm type-check && pnpm test
```

If any check fails, stop and report the failures. Do not proceed with commit.

### 6. Analyze changes and draft message

Review the diff to understand what changed:
```bash
git diff --cached
```

Check recent commits for style consistency:
```bash
git log --oneline -5
```

Draft a commit message following the conventions from step 3.

### 7. Create commit

Use HEREDOC format as documented in GIT_WORKFLOW.md:

```bash
git commit -m "$(cat <<'EOF'
type(scope): Subject line

Optional body explaining what and why.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 8. Verify success

```bash
git status
git log -1 --oneline
```

Report the commit hash and summary.

## Important

- Follow conventions from docs, don't invent new rules
- Never commit to `main` branch
- Never commit files that look like secrets (.env, credentials, etc.)
- If pre-commit checks fail, fix issues first - don't skip with --no-verify
