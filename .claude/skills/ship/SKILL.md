---
name: ship
description: Take whatever the current thread is working on to a merge on main, from any stage — an idea, uncommitted work, a branch, an open PR, a red or stuck CI, unaddressed review comments. Use when the user says ship it, get this merged, or finish this.
argument-hint: '[HON-XX | PR number | branch]'
context: inherit
---

# Ship

Find the work this thread is about, read where it stands, and run every remaining step until the PR is merged into `main`.

```
/ship              # The work this thread discussed or changed
/ship HON-123      # This issue
/ship 1424         # This PR
/ship <branch>     # This branch
```

**Invoking `/ship` is the user's explicit request** to implement in this thread and to merge (CLAUDE.md → File and queue by default, and → Merging). So do not stop for the approvals that `/plan-issue`, `/commit` or `/merge` ask for. Stop and ask only for a decision that is the user's to make: a product or design choice the thread did not settle, a destructive action on a shared database, a hook block, or a failure you could not fix.

**The steps live in `/auto-implement`.** This skill picks the entry point and lists what differs in an interactive thread. Read `.claude/skills/auto-implement/SKILL.md` before Step 5, and its sibling files when it names them. Follow them by reading; do not call them through the Skill tool, because a nested skill loses this thread's context.

## Step 1: Find the work

Take the first source that names it:

1. The argument.
2. This thread: an issue ID, a PR number or URL, a branch, or files this session changed.
3. The current branch, if it is not `main`.

Two candidates, or none → ask which work to ship, and name each candidate by what it does.

## Step 2: Read the state

Run in parallel:

```bash
git rev-parse --git-common-dir; git rev-parse --git-dir
git branch --show-current
git status --porcelain
git fetch origin main && git log --oneline origin/main..HEAD
jq -r '.workers[]? | "\(.issue) \(.branch)"' ~/.worktrees/wobblepot/orchestrator-status.json 2>/dev/null
```

```bash
# The PR for the branch: by head branch, or by number when Step 1 gave one
gh pr list --head "<branch>" --state all --json number,state,url,mergeable,mergeStateStatus,headRefName
```

For an issue: `mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })` and `mcp__linear-server__list_comments` (for a `# Plan:` comment). A branch or PR with no issue in the arguments can still carry `hon-NN` in its name or `Closes HON-NN` in its body.

## Step 3: Check the gates

Stop and ask when:

- **An orchestrator worker runs this issue or branch** (the `jq` line above lists it). Two agents on one branch race each other's pushes. The user can wait for the worker or `wt stop` it.
- **The issue has another assignee.**
- **The issue is closed** (`statusType` is `completed`, `canceled` or `duplicate`) with no merged PR, or in `triage`. Claiming it would reopen work the user closed.
- **A `blockedBy` issue is still open.** `get_issue` each one, because the relation carries no status. Work on top of an unmerged blocker builds on code that is not on `main`.
- **The PR is closed and not merged.** Ask whether to reopen it or start a new PR.

A merged PR → Step 7 only. A `Gated` or `Stranded` label does not stop you: this run is the human taking it over.

**Claim the issue now**, before the worktree: `save_issue({ id, state: "In Progress", assignee: "me" })`. Leave a PR's `In Review` issue as it is. The orchestrator only picks Queued, so the claim closes the gap in which a worker could pick it up. Then re-run the `jq` line: a worker that claimed it first is listed, and you stop.

## Step 4: Get into a worktree

Main checkout (the two `rev-parse` lines match) → call `EnterWorktree` before the first change. Pass the issue ID in lower case (`hon-123`), which resolves to the issue's existing branch, local or on `origin`, or to its `gitBranchName`. With no issue, pass the existing branch name, or `<type>/<short-slug>` for new work. Thread work already in another worktree → `EnterWorktree` with its `path`.

## Step 5: Enter the cycle at the right point

Find the first row that matches, top to bottom, and start there. **No issue yet → file it first (below), whatever the row**, so the work is tracked and the merge closes something.

| State                                                    | Start at                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| PR open, `mergeStateStatus` is `DIRTY` (conflicts)       | Resolve conflicts (below), then 6.1                                                                         |
| PR open, uncommitted changes or unpushed commits         | Run the checks, commit and push as 6.6 does, then 6.1                                                       |
| PR open                                                  | 6.1: wait for CI, then the CI-fix loop, review rounds and Phase 7                                           |
| Commits or uncommitted changes, no PR                    | Phase 4 (review and fix), then Phase 5                                                                      |
| Issue with a `# Plan:` comment, no code                  | Phase 3                                                                                                     |
| Issue with no plan                                       | 2.3 (Step 3 did 2.1 and 2.2)                                                                                |
| An idea, no code                                         | 2.3                                                                                                         |

**File the issue** by CLAUDE.md → Issue titles and → Writing for Agents. Take the problem, the decisions and the acceptance criteria from this thread; for work already done, describe what it does and why. Create it as `In Progress`, assigned to `me`, never `Queued`: the orchestrator claims a Queued issue within a minute and would race this thread. Put `Closes HON-XX` in the PR body, so Linear links a branch that does not carry the ID; an open PR gets it with `gh pr edit --body-file`.

**Resolve conflicts** by merging, not rebasing, because the hook blocks a force push: `git merge origin/main`, fix each conflict, run `pnpm lint && pnpm type-check && pnpm test`, commit, push. A conflict in `prisma/migrations/` keeps `main`'s migration as it is (CLAUDE.md → Migration immutability) and moves this branch's migration to a new, later timestamp.

## Step 6: What differs from `/auto-implement`

- **A stop becomes a question.** Where `/auto-implement` stops for a human (fix attempts used up, the CI-fix loop used up, `CI_TIMEOUT`, a stale review lock, the 6.7 hand-off), tell the user what blocks, the options and your recommendation. Do not write the 6.7 hand-off comments; the human is here.
- **The thread is the spec.** A plan for a new issue records the decisions this thread made. Work done before `/ship` needs no plan comment; Phase 4 reviews it against the issue description you filed.
- **Markers** use `[ship]` instead of `[auto-implement]`. The `[…:complete]` markers are for the orchestrator; leave them out.
- **Waiting** follows 6.1: foreground chunks of `scripts/ci-settle.sh`, re-issued until terminal. No `ScheduleWakeup`, no Monitor.
- **Merge** is 7.3: `WOBBLEPOT_ALLOW_MERGE=1 gh pr merge --squash`, without `--delete-branch` in a worktree.

## Step 7: Report

After the merge, post the 7.4 Linear summary if the issue has none. Then tell the user, naming each thing by what it does:

- What merged, with the PR link.
- The follow-ups filed, and their state.
- Anything under "Not verified" in the PR body.
- The clean-up: `wt done` from this worktree.
