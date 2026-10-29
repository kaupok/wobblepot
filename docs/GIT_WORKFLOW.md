# Git Workflow Guide

The branch model, recovery procedures, and what enforces the rules. The steps for committing, opening and merging a PR live in the skills, not here.

## Table of Contents

- [Branch Naming Convention](#branch-naming-convention)
- [Committing, Opening and Merging a PR](#committing-opening-and-merging-a-pr)
- [Recovery Procedures](#recovery-procedures)
- [Migration Immutability](#migration-immutability)
- [Blame and Bulk Commits](#blame-and-bulk-commits)
- [What Enforces What](#what-enforces-what)

## Branch Naming Convention

Which scheme to use depends on who is creating the branch and whether a Linear issue is the source:

| Scheme                   | When                                                                                                    | Example                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `<username>/hon-NN-slug` | Local or interactive work on a Linear issue — use `gitBranchName` verbatim                              | `henritamm/hon-51-feature-name`   |
| `posthog/hon-NN-slug`    | PostHog Desktop agent, Linear-sourced — `gitBranchName` with the username segment replaced by `posthog` | `posthog/hon-123-add-pantry-sync` |
| `posthog/<slug>`         | PostHog Desktop agent, no Linear issue behind the task                                                  | `posthog/fix-login-redirect`      |
| `<type>/<slug>`          | Manual work with no Linear issue                                                                        | `feat/auth-improvements`          |

**Anything Linear-sourced must carry the `hon-NN` token.** That token is what makes Linear auto-link
the branch, move the issue to In Review when the PR opens, and attach the PR — drop it and all three
stop working silently.

For the PostHog Desktop agent, `posthog/hon-NN-slug` overrides the `posthog/fix-login-redirect` example in its harness prompt whenever a Linear issue is the source. An issue is the source when the task names a HON-NNN, the originating report or thread references one, or the work was picked via `/next-issue`. With no issue, keep `posthog/<descriptive-slug>`; do not create an issue just to name a branch.

For the manual `<type>/<slug>` scheme, use these prefixes:

- `feat/` - New features (e.g., `feat/auth-improvements`)
- `fix/` - Bug fixes (e.g., `fix/login-error`)
- `docs/` - Documentation only (e.g., `docs/update-readme`)
- `refactor/` - Code refactoring (e.g., `refactor/extract-utility`)
- `chore/` - Maintenance tasks (e.g., `chore/update-deps`)

**Never use the `auto-` or `auto/` prefix for a git branch.** It's reserved for the ephemeral Neon
database branches created by the parallel workflow, which are garbage-collected by prefix match —
see [PARALLEL_WORKFLOW.md](PARALLEL_WORKFLOW.md). The collectors also reclaim any Neon branch named
`<prefix>--hon-<N>[-slug]` (`NEON_ISSUE_BRANCH_REGEX` in `scripts/worktree-claude.sh`,
`SAFE_BRANCH_REGEX` in `scripts/neon-cleanup.sh`) and orphaned `preview/*` branches, so a hand-made
Neon branch in either shape can be deleted from under you.

## Committing, Opening and Merging a PR

Use the skills: `/commit` to commit, `/create-pr` (or `/commit --pr`) to push and open the PR, and `/merge` to squash-merge it. Their steps are in [`.claude/skills/commit/SKILL.md`](../.claude/skills/commit/SKILL.md), [`.claude/skills/create-pr/SKILL.md`](../.claude/skills/create-pr/SKILL.md) and [`.claude/skills/merge/SKILL.md`](../.claude/skills/merge/SKILL.md). `/create-pr` also triggers the automatic PR review; the full sequence is in CLAUDE.md → Skill Workflow.

What the skills do not say:

- **Keep the PR description current.** When later commits add a feature or fix, change the approach, expand the scope, or rename files, update the body with `gh pr edit --body …`. The squash-merge makes the PR title and body the lasting record on `main`. Addressing review comments within the original scope, or minor refactors, need no update.

### Pre-Commit Checklist

`/commit` runs the lint, type and test checks for you; it does not run the migration check.

- [ ] On a feature branch, not `main`
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass
- [ ] If you touched `prisma/migrations/`, run the immutability check before `/commit` (or `git commit`): `git fetch origin main && bash scripts/check-migrations-immutable.sh origin/main`. It reads the working tree, so it catches a staged or unstaged edit to an applied migration before it lands in HEAD; the fetch keeps a stale `origin/main` from hiding one that landed since. Rules and recovery are in [Migration Immutability](#migration-immutability).
- [ ] Commit message and planned PR title follow Conventional Commits

## Recovery Procedures

### If You Accidentally Commit to Main

The Husky pre-commit hook normally refuses this (see [What Enforces What](#what-enforces-what)), so it only happens when the hook did not run. Move the commit to a branch:

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

5. **Open the PR with `/create-pr`.** It pushes the branch. (`/commit --pr` stops when there is nothing left to commit.)

### If Your Clone Still Points at `kaupok/honkadori`

The GitHub repository was renamed from `kaupok/honkadori` to `kaupok/wobblepot` on 2026-09-02 (HON-597), ahead of the repository going public. GitHub redirects the old name, but the redirect is lost if a repository is ever created under the old name, and tooling that reads the remote name gets confused by it. Point every clone and worktree at the new URL:

```bash
git remote set-url origin git@github.com:kaupok/wobblepot.git
git remote -v  # Should show kaupok/wobblepot for both fetch and push
```

Worktrees share the main checkout's remote configuration, so running this once there covers every worktree, new or existing. Only separate clones need it individually.

## Migration Immutability

A migration file is frozen once it is on `main`. By then staging and production have applied it, and Prisma stored a checksum of its `migration.sql`, so an edit only guarantees that `prisma migrate dev` demands a full database reset. Do not edit, delete or renumber an applied migration; add a new one that fixes forward. CI enforces this on every PR and again on every push to `main` (`scripts/check-migrations-immutable.sh`).

- **If an edit lands on `main` anyway, revert the commit** rather than fixing forward. Staging and production still hold the checksum of the original SQL, so only restoring it clears the drift. The revert's PR check fails once (expected). `Lint, Type Check & Test` is a required check on `main`, so a human merges it from a terminal with `gh pr merge --admin --squash --delete-branch` and says why in the PR; its `main` push then goes green.
- **The only way to keep a post-merge edit** is a pin in `scripts/migration-immutability-allowlist.txt`: `<path> <blob-sha|deleted> <why>`.
- **Run it locally** with `git fetch origin main && bash scripts/check-migrations-immutable.sh origin/main`. Fetch first: a stale `origin/main` omits migrations that landed since, and editing one of those then reads as an addition and passes.

A migration that never applied anywhere holds no checksum, so the revert rule does not cover it: see [`RUNBOOKS/database-recovery.md`](RUNBOOKS/database-recovery.md).

## Blame and Bulk Commits

`.git-blame-ignore-revs` lists commits that `git blame` skips, such as the repository-wide import sort (HON-1461). GitHub's blame view reads the file automatically. A local `git blame` reads it after `git config blame.ignoreRevsFile .git-blame-ignore-revs`. After a mechanical commit that touches many files merges, add its full squash SHA on `main` with a comment line, because the branch SHA does not survive the squash.

## What Enforces What

Three layers, from the commit outwards. If one of them blocks you, fix the cause; do not look for a way around it.

**1. Husky pre-commit hook** (`.husky/pre-commit`, installed by `pnpm install`). On every `git commit` it:

- refuses a commit on `main`;
- runs `pnpm type-check`;
- runs lint-staged: ESLint `--fix` and Prettier on staged `*.{ts,tsx,js,jsx}`, Prettier on staged `*.{css,md,mdx,json,mjs,cjs,mts}`.

Tests are left to CI. If the hook does not run, run `pnpm install` and check that `git config core.hooksPath` prints `.husky/_`.

**2. Claude Code `PreToolUse` hook** (`.claude/hooks/block-destructive.sh`, registered in `.claude/settings.json`, logic in `block-destructive.mts`, tests in `scripts/block-destructive-hook.test.ts`). It inspects every Bash command an agent runs, including headless workers started with `--dangerously-skip-permissions`, and blocks:

- destructive database commands (`migrate reset`, `db push --force-reset`, `DROP`, `TRUNCATE`, …);
- any `git push` to `main`, and any force push;
- `gh pr merge` without the inline `WOBBLEPOT_ALLOW_MERGE=1` prefix, which `/merge` and `/auto-implement` add.

It matches what would execute, so a `grep` or a commit message that mentions one of these commands passes. It applies to agents only; a human at a terminal is not checked.

**3. GitHub branch protection on `main`**, as `gh api "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/branches/main/protection"` reports it (checked 2026-10-13):

- A pull request is required, with 0 approving reviews, so a solo or unattended merge works.
- **The status check `Lint, Type Check & Test` is required** (HON-584). It is the aggregate job in `ci.yml` that waits for the four CI jobs and runs on every PR, docs-only ones included, so it always reports. A red or pending check makes `gh pr merge` fail with "not mergeable", which is what stops an unattended merge. `strict` is off, so a PR need not be up to date with `main` before it merges.
- The other checks stay advisory: `Vercel env-var drift audit` is skipped on forked PRs, and the Vercel deploy status is a third-party status. On a PR branch it is now always `success` ("Canceled by Ignored Build Step"), so it gates nothing (see DEPLOYMENT.md → Vercel Configuration). A required check that never reports blocks a PR for good, so none of these is safe to require.
- Force pushes and deletion of `main` are blocked.
- `enforce_admins` is off, so a repository admin can bypass these rules. **Override procedure:** a human who must merge past a known-bad check runs `gh pr merge --admin --squash --delete-branch` from a terminal and says why in the PR. `/merge` and `/auto-implement` never pass `--admin`; the unattended path has no override, by design.
- Linear history, signed commits and conversation resolution are not required.

Re-run the command above before relying on this list; it changes in the repository settings, not in this file.

**Dependabot.** Dependabot alerts are on for `kaupok/wobblepot` (HON-605). Dependabot security-update PRs and version-update PRs are deliberately off: a bot branch has no `HON-` issue, so Linear does not link it and `/merge` has no issue to close. When an alert names a runtime dependency, queue a one-line refresh issue for that package. CI's `pnpm audit --audit-level critical` gate is described in docs/DEPLOYMENT.md → Lockfile gates.
