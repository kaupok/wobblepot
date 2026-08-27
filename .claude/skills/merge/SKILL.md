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

# Check for uncommitted changes
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

Before merging, ensure all CI checks have passed. CI takes 12–45 min; Bash's 600 s foreground cap cannot cover it, so never watch checks in the foreground. Poll in the background (CLAUDE.md → Working style), then verify in the foreground:

```bash
# Run with run_in_background: true — emits one completion notification when the loop exits.
# Bounded to ci.yml's timeout-minutes (45) plus margin: 100 polls × 30 s = 50 min.
# Settles only when: at least one check exists and none is pending; the sorted name=bucket
# list is identical on two consecutive polls (fast Vercel/smoke statuses register before the
# ci.yml job does); and, for a PR with non-docs files, the ci.yml job "Lint, Type Check & Test"
# is present. Each Bash call is a fresh shell, so PR_NUMBER is derived here — never reused.
PR_NUMBER=$(gh pr view --json number --jq .number)
NON_DOCS=$(gh pr view "$PR_NUMBER" --json files --jq '.files[].path' | grep -Ev '\.md$|^docs/|^\.github/ISSUE_TEMPLATE/')
PREV=""
sleep 30  # let GitHub register the workflow run for the pushed commit before the first poll
for i in $(seq 1 100); do
  CUR=$(gh pr checks "$PR_NUMBER" --json name,bucket --jq 'sort_by(.name) | .[] | "\(.name)=\(.bucket)"' 2>/dev/null)
  OK=1
  [ -n "$CUR" ] || OK=0                                                              # at least one check exists
  printf '%s\n' "$CUR" | grep -q '=pending$' && OK=0                                 # none pending
  [ -z "$NON_DOCS" ] || printf '%s\n' "$CUR" | grep -q '^Lint, Type Check' || OK=0   # ci.yml job registered (code PRs)
  [ "$CUR" = "$PREV" ] || OK=0                                                       # identical to the previous poll
  if [ "$OK" = 1 ]; then echo CI_SETTLED; exit 0; fi
  PREV=$CUR
  sleep 30
done
echo CI_TIMEOUT; exit 1
```

If the background task ends with `CI_TIMEOUT`, report and stop — do not merge.

**Behavior:**

- If checks already passed: the loop settles on its second poll (two identical results, ~90 s including the initial sleep)
- If checks still running: polls every 30 s until no check is `pending` and the list is stable (no Bash timeout involved)
- Pass/fail is decided by the verification below, not by the loop

When the notification arrives, verify in the foreground. With `--json`, `gh pr checks` exits 0 even when checks failed or were cancelled, so the `bucket` field is the only signal — anything other than `pass`/`skipping` (`fail` or `cancel`: FAILURE, CANCELLED, TIMED_OUT, ERROR) is a failure:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
gh pr checks "$PR_NUMBER" --json name,bucket,state \
  --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.state)"'
```

- No output → all checks passed. Proceed.
- Any line printed → **On failure:** report which checks failed and stop. Do not proceed to merge.
- `no checks reported on the '<branch>' branch` on stderr (exit 1) → acceptable **only** when every changed file is excluded by `ci.yml` `paths-ignore` (`**/*.md`, `docs/**`, `.github/ISSUE_TEMPLATE/**`), i.e. no workflow was ever going to run. Otherwise checks simply have not been reported for a code change — stop. In practice this branch is unreachable here (docs-only PRs still receive Vercel and skipped smoke checks, so `gh pr checks` always reports something); it is kept as a defensive branch — do not rely on it:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
NON_DOCS=$(gh pr view "$PR_NUMBER" --json files --jq '.files[].path' | grep -Ev '\.md$|^docs/|^\.github/ISSUE_TEMPLATE/')
if [ -n "$NON_DOCS" ]; then
  echo "CI did not report checks for a code change"  # STOP — do not proceed
else
  echo "DOCS_ONLY"  # no CI workflow runs for these paths — treat as passed
fi
```

### Step 2.5: Wait for Claude Review

**Skip this step if `--force` flag is set.**

The Claude review is posted as a PR comment with a `<!-- claude-review -->` marker. It may already exist (triggered by `/create-pr`) or may need to be triggered.

Check if review already exists:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
gh api /repos/:owner/:repo/issues/${PR_NUMBER}/comments \
  --jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
```

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
gh api /repos/:owner/:repo/issues/${PR_NUMBER}/comments \
  --jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
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

**Regular repo mode:**

```bash
gh pr merge --squash --delete-branch
```

This command:

- Squash merges all commits into one
- Deletes the remote branch
- Handles the local branch deletion if possible

**Worktree mode:**

```bash
gh pr merge --squash
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
gh pr view <PR_NUMBER> --json number,title,url,commits,files

# Review comments: inline comments + review-level summaries
# (`:owner/:repo` is auto-filled by gh from the current git remote)
gh api /repos/:owner/:repo/pulls/<PR_NUMBER>/comments
gh api /repos/:owner/:repo/pulls/<PR_NUMBER>/reviews
```

**Post comment to Linear:**

First fetch the issue UUID:

```
mcp__linear-server__get_issue({ id: "HON-XX" })
```

Then post:

```
mcp__linear-server__create_comment({
  issueId: "[issue-uuid-from-linear]",
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
```

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
Or if you have `git bdone`: git bdone

[merge:complete] PR #{number} merged
```

## Error Recovery

**Merge failed mid-way:**

- If merge succeeded but checkout failed: Report merge success, guide user to manually run `git checkout main && git pull`
- If merge failed: Report the error from `gh pr merge`, do not proceed with cleanup

**Branch deletion failed:**

- Report success for merge, warn about manual branch cleanup needed
- Provide command: `git branch -D {branch_name}`
