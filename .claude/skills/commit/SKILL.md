---
name: commit
description: Create a commit following project conventions. Stages changes, runs checks, and commits with proper message format.
context: inherit
---

# Commit

Create a well-formatted commit following project conventions.

Supports optional `--pr` flag to also create a pull request after successful commit.

## Workflow

### 1. Parse arguments

Check if `--pr` flag was passed. If so, create PR after successful commit.

### 2. Verify branch

```bash
git branch --show-current
```

If on `main`:

1. First analyze the changes to determine the commit type (feat, fix, chore, docs, etc.) and a short kebab-case description
2. Create a feature branch automatically:
   ```bash
   git checkout -b <type>/<short-description>
   ```
   Example: `chore/husky-precommit-hooks`, `fix/login-validation`, `feat/user-preferences`
3. Continue with the commit workflow

### 3. Check for changes

```bash
git status
git diff --stat
git diff --cached --stat
```

If no changes (staged or unstaged), inform the user and stop.

### 4. Review conventions

Read `docs/GIT_WORKFLOW.md` for:

- Pre-commit checklist
- Commit message format
- HEREDOC syntax for commit messages

Read `CLAUDE.md` section "Commit Message Conventions" for:

- Type prefixes (feat, fix, docs, etc.)
- Scope usage
- Subject line formatting

### 5. Stage changes

```bash
git add -A
git status
```

Review what will be committed. If there are files that shouldn't be committed (secrets, generated files, etc.), warn the user.

### 6. Run pre-commit checks

```bash
pnpm lint && pnpm type-check && pnpm test
```

If any check fails, stop and report the failures. Do not proceed with commit.

### 7. Analyze changes and draft message

Review the diff to understand what changed:

```bash
git diff --cached
```

Draft a commit message following the conventions from step 4.

### 8. Create commit

Use HEREDOC format as documented in GIT_WORKFLOW.md:

```bash
git commit -m "$(cat <<'EOF'
type(scope): Subject line

Optional body explaining what and why.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

### 9. Verify success

```bash
git status
git log -1 --oneline
```

Report the commit hash and summary.

### 10. Create PR (if --pr flag)

If the `--pr` flag was passed in step 1, invoke the `/pr` skill to create the pull request.

## Important

- Follow conventions from docs, don't invent new rules
- Never commit to `main` branch
- Never commit files that look like secrets (.env, credentials, etc.)
- If pre-commit checks fail, fix issues first - don't skip with --no-verify
