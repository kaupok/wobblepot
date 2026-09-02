# Git Workflow Guide

Detailed git workflow procedures and troubleshooting for the Honkadori project.

## Table of Contents

- [Branch Naming Convention](#branch-naming-convention)
- [Complete Workflow Steps](#complete-workflow-steps)
- [Recovery Procedures](#recovery-procedures)
- [Automated Branch Protection](#automated-branch-protection)

## Branch Naming Convention

Which scheme to use depends on who is creating the branch and whether a Linear issue is the source:

| Scheme                   | When                                                                                                    | Example                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `<username>/hon-NN-slug` | Local or interactive work on a Linear issue — use `gitBranchName` verbatim                              | `kaupokorv/hon-51-feature-name`   |
| `posthog/hon-NN-slug`    | PostHog Desktop agent, Linear-sourced — `gitBranchName` with the username segment replaced by `posthog` | `posthog/hon-123-add-pantry-sync` |
| `posthog/<slug>`         | PostHog Desktop agent, no Linear issue behind the task                                                  | `posthog/fix-login-redirect`      |
| `<type>/<slug>`          | Manual work with no Linear issue                                                                        | `feat/auth-improvements`          |

**Anything Linear-sourced must carry the `hon-NN` token.** That token is what makes Linear auto-link
the branch, move the issue to In Review when the PR opens, and attach the PR — drop it and all three
stop working silently.

For the manual `<type>/<slug>` scheme, use these prefixes:

- `feat/` - New features (e.g., `feat/auth-improvements`)
- `fix/` - Bug fixes (e.g., `fix/login-error`)
- `docs/` - Documentation only (e.g., `docs/update-readme`)
- `refactor/` - Code refactoring (e.g., `refactor/extract-utility`)
- `chore/` - Maintenance tasks (e.g., `chore/update-deps`)

**Never use the `auto-` or `auto/` prefix for a git branch.** It's reserved for the ephemeral Neon
database branches created by the parallel workflow, which are garbage-collected by prefix match —
see [PARALLEL_WORKFLOW.md](PARALLEL_WORKFLOW.md).

## Complete Workflow Steps

### BEFORE making any code changes

1. **Check current branch:**

   ```bash
   git branch --show-current
   ```

   - If on `main`: CREATE A FEATURE BRANCH FIRST (step 2)
   - If on a feature branch: You're good to proceed

2. **Create and switch to feature branch:**

   ```bash
   git checkout -b feat/your-feature-name
   ```

3. **Verify you're on the correct branch:**
   ```bash
   git branch --show-current  # Should show your feature branch, NOT main
   ```

### AFTER making code changes

4. **Stage changes:**

   ```bash
   git add -A
   git status  # Review what will be committed
   ```

5. **Run tests to ensure nothing is broken:**

   ```bash
   pnpm lint          # Check for linting errors
   pnpm type-check    # Verify TypeScript types
   pnpm test          # Run unit tests
   ```

   - Fix any failures before proceeding
   - If tests fail, fix the issues and re-stage changes
   - **Note:** These same checks run in CI when you create a PR. Running them locally first helps you catch issues early and speeds up the review process.

6. **Verify branch AGAIN before committing:**

   ```bash
   git branch --show-current  # MUST NOT be 'main'
   ```

7. **Create commit:**

   ```bash
   git commit -m "$(cat <<'EOF'
   type(scope): Brief description

   Detailed description of changes...

   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
   Claude-Session: <session URL from the harness instructions, if provided>
   EOF
   )"
   ```

   Use the trailers given in the harness/system instructions when they differ from the above.

8. **Push to remote:**

   ```bash
   git push -u origin feat/your-feature-name
   ```

9. **Create pull request:**

   **IMPORTANT:** PR title must follow Conventional Commits format (same as commit messages). Since we use squash-merge, the PR title becomes the final commit message in `main`.

   **Format:** `<type>(<scope>): <subject>`

   **Example titles:**
   - `feat(auth): Add password reset functionality`
   - `fix(ui): Resolve mobile header alignment`
   - `docs(git): Add branch workflow guardrails`

   ```bash
   gh pr create --title "feat(auth): Add password reset functionality" --body "$(cat <<'EOF'
   ## Context
   [2-3 sentences explaining why these changes were made]

   ## Summary
   - [What changed]

   ## Test plan
   - [ ] [How to verify]

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

   **Context section guidance:**
   - Primary source: Linear issue description (the "why" behind the request)
   - Supplement with: Design decisions, key tradeoffs, or implementation rationale
   - Keep it brief: 2-3 sentences max
   - If no Linear issue, explain the motivation from the task/conversation

## Recovery Procedures

### If You Accidentally Commit to Main

**DO NOT PANIC.** Fix it with these steps:

1. **Create feature branch from current state:**

   ```bash
   git branch feat/your-feature-name  # Creates branch but doesn't switch
   ```

2. **Reset main to match origin:**

   ```bash
   git reset --hard origin/main
   ```

3. **Switch to feature branch:**

   ```bash
   git checkout feat/your-feature-name
   ```

4. **Verify your commit is on the feature branch:**

   ```bash
   git log -1 --oneline  # Should show your commit
   ```

5. **Push feature branch and create PR:**
   ```bash
   git push -u origin feat/your-feature-name
   gh pr create ...
   ```

### If Your Clone Still Points at `kaupok/honkadori`

The GitHub repository was renamed from `kaupok/honkadori` to `kaupok/wobblepot` on 2026-09-02 (HON-597), ahead of the repository going public. GitHub redirects the old name, but the redirect is lost if a repository is ever created under the old name, and tooling that reads the remote name gets confused by it. Point every clone and worktree at the new URL:

```bash
git remote set-url origin git@github.com:kaupok/wobblepot.git
git remote -v  # Should show kaupok/wobblepot for both fetch and push
```

Worktrees share the main checkout's remote configuration, so running this once there covers every worktree, new or existing. Only separate clones need it individually.

### Pre-Commit Checklist

Before running `git commit`, verify:

- [ ] Currently on a feature branch (NOT `main`)
- [ ] Changes are staged (`git status`)
- [ ] All tests pass (`pnpm lint && pnpm type-check && pnpm test`)
- [ ] Commit message follows Conventional Commits format
- [ ] PR title planned (must also follow Conventional Commits format)
- [ ] Ready to push and create PR

## Automated Branch Protection

We use a git pre-commit hook to automatically prevent commits to `main`. This hook is **already installed** in this project.

**What it does:**

- Blocks any commits to the main branch
- Displays helpful error message with instructions
- Reminds you to create a feature branch

**For new team members or after fresh clone:**

Git hooks install automatically when you run `pnpm install` (via Husky).

The pre-commit hook:

- Prevents commits to main branch
- Runs type-check on all TypeScript files
- Runs ESLint + Prettier on staged files (via lint-staged)

If hooks aren't working, try: `rm -rf .git/hooks/pre-commit && pnpm install`

**Bypassing the hook** (not recommended):

If you absolutely must commit to main:

```bash
git commit --no-verify
```

**Note:** Git hooks are local (`.git/hooks/` is not version controlled), so new team members need to run the setup script after cloning the repository.

## Pull Request Workflow

### Updating PR Descriptions

When pushing additional commits to an existing PR, always check if the PR description needs updating:

```bash
# Check current PR description
gh pr view --json title,body

# Review what changed in new commits
git log origin/main..HEAD --oneline
```

**Update the description if:**

- New features or fixes were added
- Implementation approach changed significantly
- Test plan needs updating
- Breaking changes were introduced
- File renames or structural changes occurred
- Scope of the PR expanded or changed

**Update using:**

```bash
gh pr edit --body "$(cat <<'EOF'
Updated description here...
EOF
)"
```

**When NOT to update:**

- Minor refactoring with same outcome
- Fixing typos or formatting
- Addressing review comments without changing scope
- Small bug fixes within the original scope

Keeping PR descriptions current helps reviewers understand the full context and ensures accurate documentation in git history (especially important for squash-merge).
