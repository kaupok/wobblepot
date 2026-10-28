---
name: merge
description: Merge approved PR and clean up local branch
context: inherit
---

# Merge PR and Clean Up

Merges a PR using squash merge, then cleans up local state.

## Usage

```
/merge              # Wait for Claude review before merging
/merge --force      # Skip Claude review gate
```

Run this command while on a feature branch that has a PR.

## Workflow

### Step 0: Parse Arguments

Check for flags:

- `--force` - Skip Claude review gate (bypass timeout wait)

### Step 1: Pre-flight Checks

Run these commands in parallel to gather state:

```bash
# Get current branch
git branch --show-current

# Uncommitted changes
git status --porcelain

# Get PR status
gh pr view --json number,title,state,headRefName,mergeable,mergeStateStatus,url 2>/dev/null

# Print the PR number — after `gh pr merge --delete-branch` HEAD is `main` and a
# bare `gh pr view` no longer resolves this PR
gh pr view --json number --jq .number
```

Note the number; you will need to paste it literally into Step 5. Bash tool calls don't share shell variables, so every pre-merge snippet below re-derives `PR_NUMBER` inline, and Step 5 uses a literal `<PR_NUMBER>` placeholder.

**Validation rules:**

| Check       | Fail Condition      | Error Message                                                                             |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Branch      | On `main`           | "You're on main. Switch to a feature branch with `git checkout <branch>`."                |
| PR exists   | No PR for branch    | "No PR found for this branch. Create one with `/create-pr` first."                               |
| Clean state | Uncommitted changes | "You have uncommitted changes. Commit with `/commit` or stash them first."                |
| PR state    | State is CLOSED     | "PR is closed. Cannot merge a closed PR."                                                 |
| Mergeable   | Not mergeable       | "PR cannot be merged. Status: {mergeStateStatus}. Check for conflicts or failing checks." |

If PR is already MERGED, skip to Step 6 (local cleanup only).

**Note:** Do NOT check for review approval. If the user asks to merge, merge it.

### Step 2: Wait for CI Checks

Before merging, ensure all CI checks have passed. PR CI takes about 4–5 min, but `ci.yml` times out at 45 min, longer than Bash's 600 s foreground cap. Interactive `/merge` runs with a TTY, so it runs each chunk of the poll with `run_in_background: true` and acts on the completion notification (CLAUDE.md → Working style names this exception). A headless run has no session to receive that notification; it waits through `/auto-implement` 6.5, which runs the same script in foreground chunks.

```bash
# Run with run_in_background: true — emits one completion notification per chunk.
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/ci-settle.sh "$PR_NUMBER"
```

`scripts/ci-settle.sh` polls for about 8 minutes and prints one marker on its last line. Its header says when it settles: the `Lint, Type Check & Test` row is present, nothing is pending, and two polls in a row agree, or that job finished 60 s or more ago on a PR head that equals the local `HEAD`. A pending Vercel status is exempt (HON-600). Act on the marker:

- `CI_WAITING` — run the same command again, in the background. The chunk count carries across calls, so 6 chunks (about 48 min) cover ci.yml's 45 min timeout.
- `CI_TIMEOUT` — report and stop. Do not merge.
- `CI_SETTLED` — verify below. If checks finished over 60 s ago and the PR head is the local `HEAD`, it settles on its first poll, in seconds; otherwise on its second poll, about 30 s later. Pass or fail is decided by the verification, not by the poll.

When the notification arrives, verify in the foreground. With `--json`, `gh pr checks` exits 0 even when checks failed or were cancelled, so the `bucket` field is the only signal — anything other than `pass`/`skipping` (`fail` or `cancel`: FAILURE, CANCELLED, TIMED_OUT, ERROR) is a failure. The one exemption matches the poll's: a still-`pending` third-party commit status (empty `workflow`) does not block, because it can stick forever after the deploy is Ready:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
# A third-party commit status (empty workflow — Vercel) is exempt while pending:
# it can stick after the deploy is Ready (HON-600). A fail still blocks. PR branches no longer
# build on Vercel (an ignored build reports success); CI's E2E `next build` is the build gate.
gh pr checks "$PR_NUMBER" --json name,bucket,state,workflow \
  --jq '.[] | select(.workflow != "" or .bucket != "pending") | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.state)"'
```

- No output → all checks passed. Proceed.
- Any line printed → **On failure:** report which checks failed and stop. Do not proceed to merge.

**Known residual risk of the exemption (accepted in HON-600).** `gh pr checks` carries no signal separating "stuck after Ready" from "still deploying", so a Vercel build merely queued past the ~13 min `Lint, Type Check & Test` job is dropped along with a stuck one. The durable fix is HON-584 (required status checks on `main`). See `.claude/skills/auto-implement/history.md` → The pending-Vercel exemption for the full note.
- `no checks reported on the '<branch>' branch` on stderr (exit 1) → report it and stop; do not merge. `ci.yml` runs on every PR, docs-only ones included, and `Lint, Type Check & Test` is a required check (HON-584), so no PR is exempt: an empty check list means CI did not report, and GitHub would refuse the merge anyway. In practice the poll above does not settle without that job's row, so this branch is defensive.

### Step 2.5: Wait for Claude Review

**Skip this step if `--force` flag is set.**

The Claude review is posted as a PR comment with a `<!-- claude-review -->` marker. It may already exist (triggered by `/create-pr`) or may need to be triggered.

Check if review already exists:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-comments.sh "$PR_NUMBER" issue \
  | jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
```

`scripts/pr-comments.sh` fetches every page and prints one JSON array. When the fetch fails it prints nothing and says why on stderr: report it, do not read it as no review.

If review exists (count > 0): proceed to Step 3.

If no review exists, trigger one and wait:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-review.sh ${PR_NUMBER}
```

This spawns `claude -p` and takes several minutes. Run it with `timeout: 600000` (or `run_in_background: true` and poll for the `<!-- claude-review -->` comment) — the default 120 s Bash timeout kills it mid-run and leaves a stale `/tmp/claude-review-N.lock`.

After the script returns, verify:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-comments.sh "$PR_NUMBER" issue \
  | jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
```

If review was posted: proceed to Step 3.

If review script failed or no review found:

```
Claude review not available.
Run `/merge --force` to bypass the review gate and merge without it.
```

**STOP here.** Do not proceed to merge without Claude review unless `--force` is used.

### Step 3: Detect Environment

Before merging, detect if we're in a worktree:

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

If outputs differ → **worktree mode**
If outputs same → **regular repo mode**

### Step 4: Merge the PR

The `WOBBLEPOT_ALLOW_MERGE=1` prefix is required: `.claude/hooks/block-destructive.mts` blocks every `gh pr merge` without it (HON-727). Keep it inline on the same command — the hook reads it from the command text, so an `export` in an earlier Bash call does not carry over.

**Regular repo mode:**

```bash
WOBBLEPOT_ALLOW_MERGE=1 gh pr merge --squash --delete-branch
```

This command:

- Squash merges all commits into one
- Deletes the remote branch
- Handles the local branch deletion if possible

**Worktree mode:**

```bash
WOBBLEPOT_ALLOW_MERGE=1 gh pr merge --squash
```

Omit `--delete-branch` because `gh` tries to checkout main internally, which conflicts with the parent worktree. The remote branch is still deleted by GitHub. The local worktree branch is preserved (user cleans up worktree manually).

### Step 5: Post Summary to Linear

After merging but before local cleanup, post a work summary to the linked Linear issue.

**Extract Linear issue ID** from the branch name saved in Step 1. Look for pattern `hon-XX` (case-insensitive) in the branch name. If no match, skip this step silently.

**Gather PR data:**

```bash
# Bash calls don't share variables — substitute the literal PR number captured in
# Step 1 for <PR_NUMBER>. After the squash merge (with --delete-branch) HEAD is `main`,
# so a bare `gh pr view` no longer resolves this PR.
# `files` is capped at 100 here and left that way on purpose (HON-587): this list is
# cosmetic, and truncating a changelog is not a merge gate.
# `body` carries the Summary's **Follow-ups** line, read for `### Follow-ups` below.
gh pr view <PR_NUMBER> --json number,title,url,body,commits,files

# Review comments: inline comments + review-level summaries, each one JSON array
./scripts/pr-comments.sh <PR_NUMBER> inline
./scripts/pr-comments.sh <PR_NUMBER> reviews
```

**Fetch the plan comment** (the one starting `# Plan:`), for its `## Follow-ups` section:

```
mcp__linear-server__list_comments({ issueId: "HON-XX" })
```

**Post comment to Linear:**

```
mcp__linear-server__save_comment({
  issueId: "HON-XX",
  body: "[summary comment]"
})
```

**Comment template:**

```markdown
## Merged: PR #XX — type(scope): Title

**PR:** [#XX](url)

### Changes
- X files changed
- [file list with +/- stats from gh pr view --json files]

### Commits
- [commit messages from gh pr view --json commits]

### Review feedback addressed
- [summary of review comments that were addressed, or "No review feedback" if none]

### Follow-ups
- [One issue ID per line: HON-NNN. Or "None".]
```

**Follow-ups hold issue IDs only.** Collect them from the plan comment's `## Follow-ups` and the PR body's **Follow-ups** line. Do not read them off the issue's `relations.blocks`: that list also holds issues blocked only for sequencing (`docs/PARALLEL_WORKFLOW.md` → "Queueing issues that touch the same files"), which are not follow-ups. If you know of a step this issue still needs that has no issue (a plan line marked `to file:`, a hand-off comment, a "Not verified" line that names a post-merge step), file it first with the `save_issue` call in `/plan-issue` step 10 (`addLabels: ["Follow-up"]`, first description line `Follow-up to HON-XX, filed by /merge.`), then list its ID. Never write the step as text under this heading or anywhere else in the comment: this issue is Done once the comment posts, and nobody reads a Done issue again (`/plan-issue` → "A follow-up is an issue", HON-1053). A follow-up filed here needs no `blockedBy`, because the change is already on `main`: use `relatedTo`.

**After posting**, print the summary to the terminal as well so the user can see it inline.

**Rules:**
- If no Linear issue ID found in branch name, skip this step entirely (no terminal output, no Linear post)
- If Linear API calls fail, still print the summary to terminal — don't block the merge flow
- Keep the summary concise — list files and stats, don't dump full diffs

### Step 6: Local Cleanup

Use the environment detected in Step 3.

**Regular repo mode:**

Save the branch name from Step 1, then:

```bash
# Switch to main
git checkout main

# Pull latest changes (includes the merged PR)
git pull origin main

# Delete local branch (-d may fail after squash merge, fallback to -D)
git branch -d {saved_branch_name} || git branch -D {saved_branch_name}
```

**Worktree mode:**

Cannot switch branches or delete the worktree branch from within. Fetch main updates and prepare cleanup info:

```bash
# Get worktree info for cleanup command
WORKTREE_PATH=$(pwd)
BRANCH_NAME=$(git branch --show-current)
MAIN_REPO=$(git rev-parse --git-common-dir | sed 's|/.git$||')

# Update origin/main in the worktree (for reference). Plain `git fetch origin main` —
# a refspec that writes local `main` is refused while `main` is checked out in the parent worktree.
git fetch origin main
```

Save `WORKTREE_PATH`, `BRANCH_NAME`, and `MAIN_REPO` for the confirmation message.

### Step 7: Confirmation

Report success and output the completion marker.

**Regular repo mode:**

```
PR #{number} merged successfully.

- Remote branch deleted
- Local branch deleted
- Now on main with latest changes

View merged PR: {url}

[merge:complete] PR #{number} merged
```

**Worktree mode:**

```
PR #{number} merged successfully.

- Remote branch deleted
- Worktree branch preserved (cleanup needed)

View merged PR: {url}

To clean up, exit this directory and run:
  cd {MAIN_REPO} && ./scripts/worktree-claude.sh cleanup {BRANCH_NAME}

Or if you have `wt` alias: wt cleanup {BRANCH_NAME}
Or run `wt done` from this worktree: it removes this worktree, then every other merged worktree and branch

[merge:complete] PR #{number} merged
```

## Error Recovery

**Merge failed mid-way:**

- If merge succeeded but checkout failed: Report merge success, guide user to manually run `git checkout main && git pull`
- If merge failed: Report the error from `gh pr merge`, do not proceed with cleanup

**Branch deletion failed:**

- Report success for merge, warn about manual branch cleanup needed
- Provide command: `git branch -D {branch_name}`
