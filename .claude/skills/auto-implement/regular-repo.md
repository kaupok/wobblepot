# Auto-implement — regular repo mode

Read from `SKILL.md` → 0.1 when `git rev-parse --git-common-dir` and `git rev-parse --git-dir` print the same path: the run is in the main checkout, not a worktree. Every orchestrator worker runs in a worktree, so this path is rare. Each step below replaces the worktree step of the same number.

## 0.2 Check branch state

```bash
git branch --show-current
```

If not on `main`:

```
[auto-implement] ✗ Error: Not on main branch. Switch to main before running /auto-implement
```

Stop here.

## 0.4 Sync with origin/main

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
```

- Exit 0 → local main already contains every remote commit. Continue.
- Exit 1 → local main is behind or has diverged. Count both sides (ahead, then behind):

```bash
git rev-list --left-right --count HEAD...origin/main
```

- Behind only (ahead = 0, behind > 0) → fast-forward, and report `[auto-implement] Fast-forwarded main: <N> new commits from origin/main`:
  ```bash
  git pull --ff-only origin main
  ```
- Diverged (both > 0) → stop:
  ```
  [auto-implement] ✗ Error: Local main has diverged from origin/main (ahead <A>, behind <B>). Resolve manually before running /auto-implement.
  ```

## 3.1 Create or switch to branch

```bash
git branch --list "[gitBranchName]"
```

If the branch exists, `git checkout [gitBranchName]`. If not, `git checkout -b [gitBranchName]`.

## 7.3 Merge the PR

```bash
WOBBLEPOT_ALLOW_MERGE=1 gh pr merge --squash --delete-branch
```

Non-zero exit → stop with the `gh` error: `[auto-implement] ✗ Error: Merge failed. PR left open.` No 7.4, no `[merge:complete]`.

## 7.5 Local cleanup

```bash
git checkout main
git pull origin main
git branch -d [branch-name] || git branch -D [branch-name]
```

## 7.6 Report completion

Print `templates.md` → Filing report first when it applies, then:

```
[auto-implement] ✓ PR merged successfully
- Remote branch deleted
- Local branch deleted
- Now on main with latest changes

[merge:complete]
[auto-implement] ✓ Autonomous implementation cycle complete
```
