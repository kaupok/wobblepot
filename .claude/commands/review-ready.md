# Pre-Commit Review Checklist

Run all quality checks before committing and creating a PR.

## Pre-Commit Checklist

- [ ] Currently on a feature branch (NOT main)
- [ ] All changes are staged
- [ ] Linting passes
- [ ] Type checking passes
- [ ] Tests pass
- [ ] Commit message follows Conventional Commits format
- [ ] PR title planned (must also follow Conventional Commits format)

## Commands to run

```bash
# Verify current branch (should NOT be 'main')
git branch --show-current

# Check git status
git status

# Run all quality checks (in parallel)
# Lint check
pnpm lint

# Type check
pnpm type-check

# Unit tests
pnpm test

# Optional: Run E2E tests (takes longer)
# pnpm test:e2e
```

## Fix Common Issues

**If linting fails:**

```bash
pnpm lint --fix
```

**If type errors:**
Review and fix TypeScript errors manually, then re-run `pnpm type-check`

**If tests fail:**
Review test failures, fix issues, then re-run `pnpm test`

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>

<body>
```

**Examples:**

- `feat(auth): Add password reset functionality`
- `fix(ui): Resolve mobile header alignment`
- `docs(git): Add branch workflow guardrails`
- `test(hooks): Add tests for useAuth hook`

## PR Title Format

**IMPORTANT:** PR title must follow Conventional Commits format (same as commit messages). Since we use squash-merge, the PR title becomes the final commit message in `main`.

## Ready to Commit?

Once all checks pass:

```bash
# Stage changes (if not already staged)
git add -A

# Create commit
git commit -m "your commit message following Conventional Commits format"

# Push to remote
git push -u origin <feature-branch-name>

# Create PR
gh pr create --title "type(scope): subject" --body "## Summary
...

## Test plan
...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
"
```
