---
name: auto-implement
description: Fully autonomous implementation cycle for a single Linear issue - finds issue, plans, implements, reviews, fixes, creates PR, addresses feedback, and merges.
context: inherit
---

# Auto-Implement

Fully autonomous development cycle: find issue → plan → implement → review → fix → create PR → address reviews → merge.

All logic is inlined to avoid nested skill context loss ([GitHub #17351](https://github.com/anthropics/claude-code/issues/17351)).

## Usage

```
/auto-implement              # Find next unblocked issue (auto-discovery applies no-human-input filters)
/auto-implement HON-51       # Use specified issue (skip issue discovery; filters NOT applied)
/auto-implement 51           # Same as above (HON- prefix optional)
```

Auto-discovery (no arg) only surfaces issues `/auto-implement` can finish end-to-end — no new env vars, DNS, legal/design review, provisioning, or subjective human review (voice/taste/native-judgment work). See Phase 1, step 1.5 for the full filter. When an issue ID is passed, the user's choice is respected without filtering.

## Execution Model

Execute phases 0-7 sequentially. Stop only on error or completion.

## Argument Parsing

Check if an issue ID was provided as argument:

- If argument matches `HON-XX` or just `XX` (numbers): Store issue ID, skip Phase 1
- If no argument: Run Phase 1 to find next unblocked issue

---

## Phase 0: Initialization

### 0.1 Detect environment (worktree vs regular repo)

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

Compare the outputs:

- If they differ → **worktree mode** (branch is managed by worktree)
- If they're the same → **regular repo mode** (must be on `main`)

### 0.2 Check branch state

**Regular repo mode:**

```bash
git branch --show-current
```

If NOT on `main`:

```
[auto-implement] ✗ Error: Not on main branch. Switch to main before running /auto-implement
```

Stop here.

**Worktree mode:**

The worktree branch is the starting point for new work. No branch check needed.

```
[auto-implement] Detected worktree environment
```

### 0.3 Check for uncommitted changes

```bash
git status --porcelain
```

If output is not empty:

```
[auto-implement] ✗ Error: Uncommitted changes detected. Commit or stash before running /auto-implement.
```

Stop here.

### 0.4 Sync with origin/main

**Why this matters:** Branching from a stale local main means every subsequent tool (Explore, planning, codebase grep) searches an outdated tree. If a related or epic-sibling issue landed on origin/main since you last pulled, its files, migrations, conventions, and constants won't be visible. At PR time you'll hit merge conflicts and schema collisions on code you didn't know existed — exactly the HON-500 ↔ HON-501 migration collision that motivated this step.

**Regular repo mode:**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
```

- Exit 0 → local main already contains all remote commits. Continue.
- Exit 1 → local main is behind or diverged. Check which case:

```bash
# How many commits ahead/behind (ahead \t behind)
git rev-list --left-right --count HEAD...origin/main
```

- Behind-only (local ahead count = 0, behind count > 0) → fast-forward:
  ```bash
  git pull --ff-only origin main
  ```
  Report the catch-up: `[auto-implement] Fast-forwarded main: <N> new commits from origin/main`.
- Diverged (both counts > 0, meaning local main has commits origin/main doesn't) → stop:
  ```
  [auto-implement] ✗ Error: Local main has diverged from origin/main (ahead <A>, behind <B>). Resolve manually before running /auto-implement.
  ```

**Worktree mode:**

The parent repo owns main; the worktree must not touch it. Fetch only, so Phase 2 planning and the git fetch in Phase 5/6 see up-to-date refs:

```bash
git fetch origin main
```

Log a catch-up summary if `origin/main` moved since the worktree was created (informational — do not block, since the worktree branch is where work happens):

```bash
git rev-list --count $(git merge-base HEAD origin/main)..origin/main
```

- > 0 → `[auto-implement] Note: origin/main has <N> new commits since this worktree branched. Plan should account for any overlap.`
- = 0 → no log line.

### 0.5 Report start

```
[auto-implement] Starting autonomous implementation cycle
[auto-implement] Phase 0/7 complete → Proceeding to Phase 1
```

---

## Phase 1: Get or Find Issue

**If issue ID was provided in arguments:**

```
[auto-implement] Phase 1/7: Using specified issue HON-XX
```

Store the issue ID.

```
[auto-implement] Phase 1/7 complete → Proceeding to Phase 2
```

**If no issue ID provided:**

```
[auto-implement] Phase 1/7: Finding next unblocked issue
```

### 1.1 Read project context

```
Read docs/PROJECT_SPEC.md
```

Review for current phase and relevant context.

### 1.2 List unassigned Backlog / Todo issues

Always pass `assignee: "null"` — In Progress / In Review / Done / Canceled issues are already claimed or complete and must never be picked up by an autonomous cycle.

```
mcp__linear-server__list_issues({ state: "Todo",    assignee: "null", limit: 20 })
mcp__linear-server__list_issues({ state: "Backlog", assignee: "null", limit: 20 })
```

### 1.3 MANDATORY: Verify every candidate with `includeRelations: true`

`list_issues` does NOT return relations. Before a candidate can enter the selection pool, re-fetch it:

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

### 1.4 Hard filters — reject the candidate if ANY of these fail

- `status` ∈ { `Backlog`, `Todo` } — reject `In Progress`, `In Review`, `Done`, `Canceled`, `Triage`.
- `assignee` is `null` — reject any assigned issue, including "me".
- Every id in `relations.blockedBy` resolves to `status` ∈ { `Done`, `Canceled` }. Empty `blockedBy` passes. Any open blocker (Backlog / Todo / In Progress / In Review) fails.
- `statusType` is not `triage` or `canceled`.

If a candidate fails any filter, discard and pick another. Do not soften or bypass a filter to keep a candidate. An autonomous cycle that picks a claimed or blocked issue will collide with other work or stall at implementation — both are worse than having no issue to pick.

### 1.5 No-human-input filters — default in auto-discovery

**Only applies when auto-discovering (no issue ID was passed as argument).** When the user passes an explicit `HON-XX`, skip this step — they've made the judgment call and Phase 1 is already short-circuited.

`/auto-implement` runs end-to-end unattended, so an auto-discovered issue must be completable without human input. Reject the candidate if the description or acceptance criteria imply any of:

- Third-party account provisioning (Upstash, PostHog, Sentry, Resend, Chromatic, Anthropic console, etc.)
- New environment variables / secrets on Vercel or elsewhere
- DNS changes (SPF/DKIM/DMARC, subdomain setup, registrar actions)
- Legal / copy review (privacy policy text, ToS, company entity details, parental consent wording)
- Design assets (OG images, branded graphics, mockups)
- Ops access (authenticated CLI like `neonctl` against production, Vercel dashboard edits, GitHub org settings)
- Shared-state side effects (staging DB writes that can't be reset, sending real emails, outbound API calls that cost money)
- Subjective human review — the acceptance criteria require a human to *validate quality*, not just to provide inputs. An agent can produce the artifact but cannot close the ticket. Covers: native-speaker / native-judgment work (voice, tone, register, idiom), copy or naming quality review, design polish review, and any AC that name-drops a specific reviewer ("does Kaupo read this and…"). Distinct from "legal / copy review" — that's about *clearance*; this is about *taste*.

Skim for red-flag phrases: "add env var", "add secret", "configure DNS", "sign up", "provision", "API key", "`support@`", "legal entity", "OÜ", "Resend", "Upstash", "PostHog", "Sentry", "Anthropic console", "Vercel dashboard", "manual spot-check", "reads natural", "feels native", "idiomatic Estonian", "voice reference", "tone of voice", "native speaker", "copy review", and any AC that references a specific human by name as the reviewer.

Also reject `[DRAFT]` titles in auto-discovery — a draft spec is not ready to implement unattended.

If all candidates fail, exit normally per step 1.7 ("No unblocked issues found"). Do not soften the filter to find a match — a stalled half-PR is worse than no work.

### 1.6 Prioritize surviving candidates

- Todo before Backlog
- Issues that unblock others (larger `blocks` array) before leaf issues
- Higher priority (lower `priority.value`) before lower

### 1.7 Select issue

If no unblocked issues found:

```
[auto-implement] ✓ No unblocked issues found. Nothing to implement.
```

Stop here (normal exit).

Otherwise, store the issue ID:

```
[auto-implement] ✓ Selected: HON-XX - [Title]
[auto-implement] Phase 1/7 complete → Proceeding to Phase 2
```

---

## Phase 2: Plan Implementation

```
[auto-implement] Phase 2/7: Planning implementation for HON-XX
```

### 2.1 Claim issue immediately

Set status to "In Progress" and assign to self right away, before any planning work. This prevents other agents from picking the same issue concurrently.

```
mcp__linear-server__save_issue({
  id: "HON-XX",
  state: "In Progress",
  assignee: "me"
})
```

### 2.2 Fetch issue details

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract and note:

- Issue UUID (for API calls)
- Title and description
- `gitBranchName` for later use
- `blockedBy` relations (should be empty or done)
- `blocks` relations (what this unblocks)
- `relatedTo` / `parentId` (for overlap check in 2.3)
- Any labels or priority

### 2.3 MANDATORY: Check relatedTo + epic siblings for recently-merged overlap

**Why:** When an issue is part of an epic (has `parentId`) or has `relatedTo` links, a sibling issue may have already landed and introduced files, conventions, schema, or constants that your plan needs to build on rather than duplicate. `blockedBy` is checked by Phase 1's selection filter, but `relatedTo` / epic-siblings are not — and a Done sibling in the same epic is a strong "check for overlap" signal. The HON-500 ↔ HON-501 incident (duplicate `Household.locale` schema change, duplicate `locales.ts`) is what motivated this step.

For each id in `relations.relatedTo` and (if `parentId` is set) each sub-issue of the parent:

```
mcp__linear-server__get_issue({ id: "HON-YY", includeRelations: true })
```

For any sibling where `status` ∈ { `Done`, `In Review`, `In Progress` }:

- Note its title, `gitBranchName`, and completion/start time.
- If status is `Done` AND `completedAt` is within the last 14 days, fetch the merged PR to see what files it touched:
  ```bash
  gh pr list --search "HON-YY in:title" --state merged --json number,title,files,mergedAt --limit 1
  ```
  Inspect the `files` array. If any overlap with `prisma/schema.prisma`, `prisma/migrations/`, or other files you expect to modify, flag it in the plan's **Design Decisions** table and adjust the approach (extend rather than duplicate).
- If status is `In Progress` / `In Review`, surface it as a coordination risk in the plan's context so the user knows parallel work is happening.

Surface findings inline:

```
[auto-implement] Sibling check: HON-YY ([status], merged PR #<N>) touches prisma/schema.prisma — plan must extend, not duplicate.
```

If no siblings match, log a one-line confirmation and continue:

```
[auto-implement] Sibling check: no recently-merged/in-flight related issues.
```

### 2.4 Read project context (if not already loaded)

If Phase 1 ran (no issue ID provided), `docs/PROJECT_SPEC.md` is already in context — skip this step.

If Phase 1 was skipped (issue ID provided as argument):

```
Read docs/PROJECT_SPEC.md
```

Note the current phase and any relevant architectural decisions.

### 2.5 Fetch issue comments

```
mcp__linear-server__list_comments({ issueId: "[issue-uuid]" })
```

Review any prior discussion, decisions, or context from team members.

### 2.6 Explore codebase

Using Read, Grep, and Glob tools:

- Identify key files mentioned in the issue
- Find existing patterns to follow
- Note related components or APIs

Focus on files directly relevant to the issue (2-5 files max).

**If Phase 2.3 flagged any recently-merged sibling issues:** also run `git log --oneline --since="14 days ago" -- <overlapping-paths>` and `git diff origin/main~<N>..origin/main -- <overlapping-paths>` to see what the sibling actually changed. The Explore agent sees only static file content; it can't know which lines are new. Reading the diff prevents the "I searched and it didn't exist" → "it existed and I duplicated it" failure mode.

### 2.7 Write plan

Write the plan directly in your response using this structure:

```markdown
# Plan: HON-XX - [Issue Title]

**Issue:** HON-XX
**Branch:** `[gitBranchName from Linear]`

## Context

[2-3 sentence summary of the issue and relevant background]

## Design Decisions

| Decision       | Choice        | Rationale |
| -------------- | ------------- | --------- |
| [Key decision] | [Your choice] | [Why]     |

## Files to Create

- `src/path/to/new/file.tsx` - [Purpose]

## Files to Modify

- `src/path/to/existing/file.ts` - [What changes]

## Implementation Steps

1. [Specific step with details]
2. [Specific step with details]
3. [Specific step with details]

## Tests

- `src/path/to/file.test.ts` - [What to test]

## Verification

- [ ] [How to test the implementation]
- [ ] [What to verify works correctly]
- [ ] [Edge cases to check]
```

### 2.8 Post plan to Linear

Post the plan directly to Linear (no approval needed in auto mode):

```
mcp__linear-server__save_comment({
  issueId: "HON-XX",
  body: "[The complete plan from step 2.7]"
})
```

**CRITICAL: Do NOT proceed to Phase 3 until the plan has been successfully posted to Linear.** If the `save_comment` call fails, retry once. If it fails again, stop with error:

```
[auto-implement] ✗ Error: Failed to post plan to Linear. Cannot proceed without documented plan.
```

On success:

```
[auto-implement] ✓ Plan posted to Linear
[plan-issue:complete]
[auto-implement] Phase 2/7 complete → Proceeding to Phase 3
```

---

## Phase 3: Implement

```
[auto-implement] Phase 3/7: Implementing HON-XX
```

### 3.1 Create or switch to branch

**Worktree mode:**

The worktree branch is already set. Just verify:

```bash
git branch --show-current
```

**Regular repo mode:**

Check if branch already exists:

```bash
git branch --list "[gitBranchName]"
```

If branch exists:

```bash
git checkout [gitBranchName]
```

If branch doesn't exist:

```bash
git checkout -b [gitBranchName]
```

### 3.2 Implement following the plan

The plan from Phase 2.7 is already in context — do not re-fetch it from Linear.

For each implementation step in the plan:

1. Read relevant files using Read tool
2. Make changes using Edit or Write tools
3. Write tests for new functionality (unit tests colocated with source files)
4. Follow patterns from CLAUDE.md
5. If `src/components/**` changed → create/update the colocated `.stories.tsx` (CLAUDE.md Storybook rule) and run `pnpm test-storybook:ci`

```
[auto-implement] ✓ Implementation complete
[implement-issue:complete]
[auto-implement] Phase 3/7 complete → Proceeding to Phase 4
```

---

## Phase 4: Review and Fix

```
[auto-implement] Phase 4/7: Reviewing changes
```

### 4.1 Collect all changes

```bash
# Committed changes (vs main)
git diff --name-only origin/main...HEAD

# Staged but uncommitted
git diff --cached --name-only

# Unstaged changes
git diff --name-only

# Untracked files
git ls-files --others --exclude-standard
```

Deduplicate the file list.

### 4.2 Get the diffs

```bash
# All changes combined
git diff origin/main...HEAD
git diff --cached
git diff
```

For untracked files, use Read tool.

### 4.3 Review the changes for

CLAUDE.md is already loaded as project instructions — do not re-read it. Read `docs/TYPOGRAPHY.md` only if the changes involve typography components.

- **Bugs**: Logic errors, edge cases, null/undefined handling
- **Security**: Injection risks, auth bypasses, sensitive data exposure
- **Patterns**: Adherence to CLAUDE.md conventions (sentence case, typography components, etc.)
- **TypeScript**: Type safety, any types, missing types
- **Tests**: Missing test coverage for new functionality
- **Performance**: N+1 queries, unnecessary re-renders, large bundle imports
- **E2E drift**: If the diff includes `src/app/**/page.tsx`, a route URL, a modal/dialog component, or changes user-visible copy in a heading/button/link, grep `tests/e2e/` for stale references via the spec `// ROUTES: … · COMPONENTS: …` headers (`grep -l "ROUTES.*<route>\|COMPONENTS.*<OldName>" tests/e2e/*.spec.ts`; for copy renames also `grep -rn "<exact old copy>" tests/e2e/`) and update affected specs (CLAUDE.md E2E rule)
- **Storybook**: If the diff touches `src/components/**`, the colocated `.stories.tsx` was created/updated for the new variants and states and `pnpm test-storybook:ci` passes (CLAUDE.md Storybook rule)

### 4.4 Triage issues

Using **effort-first** thinking:

- Quick fix (< 5 min) → **address now**
- Moderate fix (15-30 min, in scope) → **address now**
- Significant work (hours) → defer only if truly out of scope

Categories:

- **Address Now**: Fix before PR merge
- **Defer**: Only for significant out-of-scope work
- **Skip**: Disagree or not actionable

### 4.5 Fix loop

If there are issues to address:

```
max_attempts = 3
attempt = 0

while issues remain and attempt < max_attempts:
    attempt += 1
    [auto-implement] Fix attempt {attempt}/3

    For each issue in "Address Now":
        - Read the file at the specified location
        - Analyze the issue and code context
        - Apply the fix using Edit tool

    # Re-run checks
    pnpm lint && pnpm type-check && pnpm test

    If all pass: break
    If same errors persist: continue with next attempt
```

If still failing after 3 attempts:

```
[auto-implement] ✗ Error: Failed to fix issues after 3 attempts. Manual intervention required.
```

Stop here with failure details.

### 4.6 Proceed

```
[auto-implement] ✓ All checks passing
[branch-review:complete]
[auto-implement] Phase 4/7 complete → Proceeding to Phase 5
```

---

## Phase 5: Commit and Create PR

```
[auto-implement] Phase 5/7: Creating commit and PR
```

### 5.1 Stage changes

List changed/untracked files and stage them by name. Do NOT use `git add -A` or `git add .`.

```bash
git status --porcelain
```

Stage specific files (example):

```bash
git add src/components/MyComponent.tsx src/components/MyComponent.test.tsx
```

Review what will be committed. Warn and exclude if secrets detected (`.env`, credentials, etc.).

### 5.2 Create commit

Follow commit conventions from CLAUDE.md. Use HEREDOC format:

```bash
git commit -m "$(cat <<'EOF'
type(scope): Subject line

Body explaining what and why.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: <session URL from the harness instructions, if provided>
EOF
)"
```

Use the trailers given in the harness/system instructions when they differ from the above.

### 5.3 Analyze for PR description

```bash
# All commits on this branch
git log origin/main..HEAD --format="%s%n%b"

# Full diff
git diff origin/main...HEAD --stat
```

Fetch issue description from Linear for the "Context" section.

### 5.4 Push and create PR

```bash
# Push with upstream tracking
git push -u origin $(git branch --show-current)

# Create PR using HEREDOC
gh pr create --title "type(scope): Subject" --body "$(cat <<'EOF'
## Context

[Why these changes were made. From Linear issue description. Closes HON-XX]

## Summary

- [Bullet points describing changes]

## Test plan

- [ ] [How to verify changes]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Extract PR URL from output.

```
[auto-implement] ✓ PR created: [URL]
[create-pr:complete]
[auto-implement] Phase 5/7 complete → Proceeding to Phase 6
```

---

## Phase 6: Address Reviews

```
[auto-implement] Phase 6/7: Addressing reviews
```

### 6.1 Wait for CI

CI takes 12–45 min; Bash's 600 s foreground cap cannot cover it, so never watch checks in the foreground. Poll in the background (CLAUDE.md → Working style), then verify in the foreground:

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

When the notification arrives, verify in the foreground. With `--json`, `gh pr checks` exits 0 even when checks failed or were cancelled, so the `bucket` field is the only signal — anything other than `pass`/`skipping` (`fail` or `cancel`: FAILURE, CANCELLED, TIMED_OUT, ERROR) is a failure:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
gh pr checks "$PR_NUMBER" --json name,bucket,state \
  --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.state)"'
```

- No output → all checks passed. Proceed.
- Any line printed → CI is failing (check names and states listed).
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

If CI fails, attempt to fix (max 2 attempts):

```
ci_attempts = 0
max_ci_attempts = 2

while CI failing and ci_attempts < max_ci_attempts:
    ci_attempts += 1
    [auto-implement] CI fix attempt {ci_attempts}/2

    - Analyze CI failure output
    - Apply fixes using Edit tool
    - Stage specific changed files by name and commit:
      git add [changed files] && git commit -m "fix: Address CI failures"
    - Push: git push
    - Wait: re-run the background poll + foreground verification above

If still failing after 2 attempts:
    [auto-implement] ✗ Error: CI checks failing after fix attempts
    Stop here with failure details
```

### 6.2 Get PR info

```bash
gh pr view --json number,title,headRefName,url
```

### 6.3 Trigger Claude review

Spawn a fresh Claude Code session to review the PR. **You MUST use the script below — do NOT inline the review prompt or spawn claude directly.** The script handles model selection (Opus), locking, and prompt formatting.

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-review.sh ${PR_NUMBER}
```

This runs synchronously. When it returns, the review has been posted to GitHub. It spawns `claude -p` and takes several minutes — run it with `timeout: 600000` (or `run_in_background: true` and poll for the `<!-- claude-review -->` comment); the default 120 s Bash timeout kills it mid-run and leaves a stale `/tmp/claude-review-N.lock`.

```
[auto-implement] Running Claude review for PR #${PR_NUMBER}...
```

Verify the review was posted:

```bash
gh api /repos/:owner/:repo/issues/{number}/comments \
  --jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
```

If the review was posted (count > 0):
```
[auto-implement] ✓ Claude review received
```

If no review found after script returned (unexpected):
```
[auto-implement] ⚠ Review script returned but no review comment found. Proceeding anyway.
```

If the review script fails (non-zero exit):
```
[auto-implement] ✗ Error: Review script failed. Stopping to prevent merging without code review.
Stop here (non-zero exit)
```

### 6.4 Parse and triage review comments

Fetch the inline review comments posted by the reviewer:

```bash
gh api /repos/:owner/:repo/pulls/{number}/comments \
  --jq '[.[] | select(.body | startswith("**"))]'
```

Also fetch the summary comment:

```bash
gh api /repos/:owner/:repo/issues/{number}/comments \
  --jq '.[] | select(.body | startswith("<!-- claude-review -->")) | .body'
```

**Triage rules:**

The reviewer only posts substantive issues (no nitpicks), so triage is simpler:

- If summary contains "No issues found" → clean review, skip to Phase 7
- Every inline review comment → **Address Now** (they are all substantive by design)
- Use effort-first thinking for prioritization:
  - Quick fix → address now
  - Moderate fix → address now
  - Significant work → defer if genuinely out of scope

### 6.5 Address review comments

For each item in "Address Now":

- Extract file path and line number
- Read the file at that location
- Apply the suggested fix using Edit tool

### 6.6 Commit and push fixes

If fixes were made:

```bash
git status --porcelain
```

If changes exist, stage specific changed files by name:

```bash
git add [changed files]
git commit -m "$(cat <<'EOF'
fix: Address review feedback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: <session URL from the harness instructions, if provided>
EOF
)"
git push
```

Wait for CI again — re-run the 6.1 background poll + foreground verification (never watch checks in the foreground).

```
[auto-implement] ✓ Reviews addressed
[review-pr:complete]
[auto-implement] Phase 6/7 complete → Proceeding to Phase 7
```

---

## Phase 7: Merge

```
[auto-implement] Phase 7/7: Merging PR
```

### 7.1 Pre-flight checks

```bash
# Check for uncommitted changes
git status --porcelain

# Get PR status
gh pr view --json number,state,mergeable,mergeStateStatus,url
```

Validation:

| Check     | Fail Condition | Error Message                          |
| --------- | -------------- | -------------------------------------- |
| PR state  | CLOSED         | "PR is closed. Cannot merge."          |
| Mergeable | Not mergeable  | "PR cannot be merged. Check conflicts" |

### 7.2 Wait for CI

Same mechanism as 6.1 — background poll, then foreground verification. Never watch checks in the foreground (Bash's 600 s cap is shorter than a CI run).

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

**CRITICAL: When the notification arrives, verify ALL checks passed — including Vercel deployment.** With `--json`, `gh pr checks` exits 0 even when checks failed or were cancelled, so inspect `bucket`: anything other than `pass`/`skipping` (`fail` or `cancel` — FAILURE, CANCELLED, TIMED_OUT, ERROR) is a failure:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
gh pr checks "$PR_NUMBER" --json name,bucket,state \
  --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.state)"'
```

- No output → all checks passed. Proceed to 7.3.
- Any line printed → **STOP — do NOT merge.** Report the listed checks.
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

**Do NOT merge if any check is in the `fail` or `cancel` bucket, including Vercel deployment checks.** This is a hard gate — no exceptions.

### 7.3 Merge the PR

**Detect environment first** (reuse from Phase 0):

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

**Regular repo mode:**

```bash
gh pr merge --squash --delete-branch
```

**Worktree mode:**

`gh pr merge --delete-branch` fails in worktrees because `gh` tries to checkout main internally, which conflicts with the parent worktree. Use without `--delete-branch`:

```bash
gh pr merge --squash
```

The remote branch is still deleted by GitHub. The local worktree branch is preserved (user cleans up worktree manually).

### 7.4 Post summary to Linear

After merging but before local cleanup, post a work summary to the Linear issue.

The PR number and URL are available from Phase 5.4 / Phase 6.2.

**Gather PR data:**

```bash
# Bash calls don't share variables — substitute the literal PR number captured in
# Phase 6.2 for <PR_NUMBER>. After the squash merge (with --delete-branch) HEAD is `main`,
# so a bare `gh pr view` no longer resolves this PR.
gh pr view <PR_NUMBER> --json number,title,url,commits,files

# Review comments: inline comments + review-level summaries
# (`:owner/:repo` is auto-filled by gh from the current git remote)
gh api /repos/:owner/:repo/pulls/<PR_NUMBER>/comments
gh api /repos/:owner/:repo/pulls/<PR_NUMBER>/reviews
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

### Summary

[2-3 sentence plain-language summary of what was done and why. Describe the user-facing or architectural impact, not just "changed files". This should read like a mini changelog entry.]

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
- If Linear API calls fail, still print the summary to terminal — don't block the merge flow
- Keep the summary concise — list files and stats, don't dump full diffs

### 7.5 Local cleanup

**Regular repo mode:**

```bash
git checkout main
git pull origin main
git branch -d [branch-name] || git branch -D [branch-name]
```

**Worktree mode:**

Cannot fetch into main (already checked out in parent worktree). Skip local cleanup - the worktree will be removed by the user.

**Neon branch cleanup:** No action needed here. `.github/workflows/neon-cleanup.yml` is the source of truth — it fires on `pull_request.closed` with `merged == true` and reaps the paired `auto--hon-<N>` Neon branch. A weekly sweep catches anything that escapes. See [`docs/RUNBOOKS/neon-branch-gc.md`](../../../docs/RUNBOOKS/neon-branch-gc.md).

### 7.6 Report completion

**Regular repo mode:**

```
[auto-implement] ✓ PR merged successfully
- Remote branch deleted
- Local branch deleted
- Now on main with latest changes

[merge:complete]
[auto-implement] ✓ Autonomous implementation cycle complete
```

**Worktree mode:**

```
[auto-implement] ✓ PR merged successfully
- Remote branch deleted
- Worktree branch preserved

To clean up this worktree:
  git worktree remove <worktree-path>

[merge:complete]
[auto-implement] ✓ Autonomous implementation cycle complete
```

---

## Error Summary

| Phase | Error                           | Action                 |
| ----- | ------------------------------- | ---------------------- |
| 0     | Not on main (regular repo only) | Stop with instructions |
| 0     | Uncommitted changes             | Stop with instructions |
| 0     | Local main diverged from origin | Stop, ask user to resolve |
| 1     | No unblocked issues             | Stop (normal exit)     |
| 4     | Fix attempts exhausted (3)      | Stop, show failures    |
| 5     | Commit/PR fails                 | Stop, show error       |
| 6     | CI fails after fixes (2)        | Stop, show failures    |
| 6     | Review script failed            | Stop, show error       |
| 6     | Review parse fails              | Stop, show error       |
| 7     | Merge fails                     | Stop, show error       |
