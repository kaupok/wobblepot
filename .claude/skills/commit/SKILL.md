---
name: commit
description: Create a commit following project conventions. Stages changes, runs checks, and commits with proper message format.
context: inherit
---

# Commit

Create a well-formatted commit following project conventions.

Supports optional flags:

- `--pr` - Create a pull request after successful commit
- `--push` - Push to remote after successful commit

## Workflow

### 1. Parse arguments

Check for flags:

- `--pr` - Will create PR after commit (implies push)
- `--push` - Will push after commit

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

### 10. Post-commit actions (if flags passed)

**If `--pr` flag:** Invoke the `/pr` skill to create the pull request (this handles pushing).

**If `--push` flag (without --pr):** Push to remote:

```bash
git push
```

### 11. Signal completion

Output the completion marker based on what was done:

- If `--pr` was used: `[commit:complete] Commit created and PR opened`
- If `--push` was used: `[commit:complete] Commit created and pushed`
- Otherwise: `[commit:complete] Commit created`

The calling context will determine what happens next.

## Important

- Follow conventions from docs, don't invent new rules
- Never commit to `main` branch
- Never commit files that look like secrets (.env, credentials, etc.)
- If pre-commit checks fail, fix issues first - don't skip with --no-verify
