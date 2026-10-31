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

## 3.1 Enter a worktree

Call `EnterWorktree` with `name: "hon-NN"` (the issue ID in lower case). The `WorktreeCreate` hook resolves it to the issue's branch, local or on `origin`, or to its `gitBranchName`. Do not switch branch in place: the main checkout is shared with other sessions, so `guard-main-checkout` blocks it. Verify with `git branch --show-current`.

From here the run is in a worktree, so 7.3, 7.5 and 7.6 follow `SKILL.md`.
