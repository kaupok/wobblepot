---
name: auto-implement
description: "Fully autonomous cycle for one Linear issue, through to merge: plan, implement, review, PR, address feedback, merge. Use only when the user says auto-implement or asks for the full unattended cycle. For 'implement <issue>' use /implement-issue."
context: inherit
---

# Auto-Implement

Logic is inlined, because a nested skill loses its context.

```
/auto-implement          # Find the next Queued issue an agent can finish alone (discovery.md)
/auto-implement <ID>     # Use this issue; the discovery filters are NOT applied
```

`<ID>` is the issue identifier; a bare number gets the team prefix. It is the **first token only**. Arguments that continue with `Retry context:` → **read `recovery.md` → Retry context first.**

## Execution model

Run phases 0-7 in order; stop only on error or completion. **Every turn ends in a terminal state**, because a headless worker exits when its turn ends and in-flight work dies with it. The last message is a phase marker, an error stop, the 6.7 hand-off, or the completion marker, never future-tense prose about in-flight work ("CI is re-running — I'll merge once it settles").

Sibling files, read when they apply and before acting:

- `discovery.md`: no issue ID was passed (Phase 1)
- `regular-repo.md`: 0.1 finds no worktree
- `templates.md`: 2.6 (Explore prompt), 2.7 (plan), 7.4 (Linear summary), 7.6 (filing report)
- `recovery.md`: retry context, 2.1 stops, CI failures, a missing review
- `pre-pr-checks.md`: 4.3, the local review and the reviewer's recurring rules, before the PR opens
- `batched.md`: batched plans, or a verification that outruns the 600 s cap
- `review-cap.md`: `ROUND` ≥ 3, `not actioned:` notes, the 6.7 hand-off
- `deferral.md`: filing a deferred finding or a follow-up (2.8, 3.2, 6.8)
- `history.md`: changing or disputing a rule; never needed to run a cycle

Triage in 4.4 and 6.4 uses `docs/TRIAGE_RUBRIC.md`.

---

## Phase 0: Initialization

### 0.1 Detect environment

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

Different → print `[auto-implement] Detected worktree environment`. The same → regular repo mode: `regular-repo.md` replaces 0.2, 0.4, 3.1, 7.3, 7.5, 7.6.

### 0.2 Check branch state

Worktree mode: no check.

### 0.3 Check for uncommitted changes

```bash
git status --porcelain
```

Any output → stop: `[auto-implement] ✗ Error: Uncommitted changes detected. Commit or stash before running /auto-implement.`

### 0.4 Sync with origin/main

Worktree mode fetches only; the parent checkout owns main.

```bash
git fetch origin main
git rev-list --count $(git merge-base HEAD origin/main)..origin/main
```

Above 0 → `[auto-implement] Note: origin/main has <N> new commits since this worktree branched. Plan should account for any overlap.` Do not block.

### 0.5 Report start

```
[auto-implement] Starting autonomous implementation cycle
[auto-implement] Phase 0/7 complete → Proceeding to Phase 1
```

---

## Phase 1: Get or Find Issue

With an ID: `[auto-implement] Phase 1/7: Using specified issue <ID>`, then `[auto-implement] Phase 1/7 complete → Proceeding to Phase 2`. Without one: run `discovery.md`.

---

## Phase 2: Plan Implementation

`[auto-implement] Phase 2/7: Planning implementation for <ID>`

### 2.1 Fetch issue details and gate

```
mcp__linear-server__get_issue({ id: "<ID>", includeRelations: true })
```

**Gate in this order, stop at the first failure.** The orchestrator pre-claims as `In Progress` with no assignee, so that pair is normal.

1. **Status** (`statusType`): `backlog` / `unstarted` pass. `started` passes only as `In Progress`; `In Review` stops unless `recovery.md` → Retry context allows it. `completed`, `canceled`, `duplicate`, `triage` stop.
2. **Assignee**: `Queued` passes whatever the assignee. Otherwise `mcp__linear-server__get_user({ query: "me" })`; pass if null or your id.
3. **Blockers**: the relation carries no status, so `get_issue` each `blockedBy` entry. Pass if all are `completed` or `canceled`.

**On any stop, read `recovery.md` → Gate stops first**: it undoes the pre-claim.

### 2.2 Claim issue

Before any planning:

```
mcp__linear-server__save_issue({ id: "<ID>", state: "In Progress", assignee: "me" })
```

### 2.3 Check related and sibling issues for overlap

`get_issue` each `relatedTo` issue and, if `parentId` is set, each sub-issue of the parent. For each in `Done`, `In Review` or `In Progress`:

- **Done within 14 days**: find its merged PR by branch; on `[]`, by body, keeping only `Closes <sibling ID>`:
  ```bash
  gh pr list --head "<gitBranchName>" --state merged --json number,title,files,mergedAt --limit 1
  gh pr list --search "<sibling ID> in:body" --state merged --json number,title,files,mergedAt,body
  ```
  Overlap with `prisma/schema.prisma`, `prisma/migrations/` or your files → a Design Decisions row: extend, not duplicate.
- **In Progress / In Review**: name it in Context as parallel work.

Print `[auto-implement] Sibling check: <sibling> ([status], merged PR #<N>) touches <file> — plan must extend, not duplicate.` per match, or `[auto-implement] Sibling check: no recently-merged/in-flight related issues.`

### 2.4 Read project context

If Phase 1 was skipped, the 2.6 Explore call reads `docs/PROJECT_SPEC.md`; discovery already read it.

### 2.5 Fetch issue comments

```
mcp__linear-server__list_comments({ issueId: "[issue-uuid]" })
```

### 2.6 Explore codebase

**From 2.4 until the plan posts, read no file outside `.claude/skills/`: a file read in the main context is paid on every later request.** One read-only subagent reads instead and returns a short brief. Fill its prompt from `templates.md` → Explore prompt, with the 2.3 siblings:

```
Agent({ subagent_type: "Explore", model: "sonnet", run_in_background: false, description: "Explore for <ID>", prompt: "<templates.md → Explore prompt, filled>" })
```

`run_in_background: false`, because a headless worker exits when its turn ends. Plan from the brief; read the files you edit in Phase 3.

### 2.7 Write plan

Write it with `templates.md` → Plan.

### 2.8 File follow-ups, then post plan to Linear

File each `to file:` line by `deferral.md` → Follow-ups and swap in its ID. Post only when every line has one. Two failures → stop: `[auto-implement] ✗ Error: Failed to file follow-up "<the step>" in Linear. Plan not posted.`

```
mcp__linear-server__save_comment({ issueId: "<ID>", body: "[The complete plan from 2.7]" })
```

A retry reads the plan from Linear, so retry a failed post once, then stop: `[auto-implement] ✗ Error: Failed to post plan to Linear. Cannot proceed without documented plan.`

```
[auto-implement] ✓ Plan posted to Linear
[plan-issue:complete]
[auto-implement] Phase 2/7 complete → Proceeding to Phase 3
```

---

## Phase 3: Implement

`[auto-implement] Phase 3/7: Implementing <ID>`

### 3.1 Create or switch to branch

Worktree mode: verify with `git branch --show-current`.

### 3.2 Implement following the plan

Per plan step (the plan is in context):

1. Make the change, with colocated tests for new behaviour.
2. `src/components/**` changed → update the colocated `.stories.tsx`, run `pnpm test-storybook:ci`.
3. Edit every **Mirror** in `## Coupled callsites` now; no later step picks them up.
4. A needed step the PR cannot ship (a golden re-record, a backfill) → file it now by `deferral.md` → Follow-ups; keep the ID for 5.4.

### 3.3 Batched plans and long verification

Sequential batches, or a verification over 600 s (`pnpm test:e2e:local`, a large `pnpm test-storybook:ci`) → **read `batched.md` first.**

```
[auto-implement] ✓ Implementation complete
[implement-issue:complete]
[auto-implement] Phase 3/7 complete → Proceeding to Phase 4
```

---

## Phase 4: Review and Fix

`[auto-implement] Phase 4/7: Reviewing changes`

### 4.1 Collect all changes

```bash
git diff --name-only origin/main...HEAD
git diff --cached --name-only
git diff --name-only
git ls-files --others --exclude-standard
```

### 4.2 Get the diffs

Read sizes, not full diffs; the 4.3 local review reads the full diff.

```bash
git diff --stat origin/main...HEAD
git diff --stat --cached
git diff --stat
```

Then `git diff origin/main...HEAD -- <file>` (or `--cached`, or unstaged) only for files 4.3 must judge. Read untracked files with Read.

### 4.3 Review the changes

Run the PR reviewer's prompt on the local changes, in the foreground with `timeout: 600000`, then read the file. It posts nothing; a failure: `pre-pr-checks.md` → Local review.

```bash
./scripts/pr-review.sh --local <ID>
cat /tmp/auto-implement-local-review-<ID>.md
```

Then check, reading `docs/TYPOGRAPHY.md` only if typography components changed:

- **E2E drift**: a page, route URL, dialog, or heading/button/link copy changed → `grep -l "ROUTES.*<route>\|COMPONENTS.*<OldName>" tests/e2e/*.spec.ts`, and for copy `grep -rn "<exact old copy>" tests/e2e/`; update the specs
- **Driven screens**: a screen changed → after 4.5, run `.claude/skills/implement-issue/SKILL.md` → "Drive changed screens"; keep its `Driven:` lines
- **Shared-primitive coupling**: run `/plan-issue` step 7b's greps against the **old** literal; every Mirror moved, `loading.tsx` skeletons included
- **Recurring reviewer rules**: run every item in `pre-pr-checks.md` (AI eval report, tests that go red, PR body proof, plan deviations)

### 4.4 Triage issues

Triage the local review's findings by the 6.4 rules; they are not a round, because `ROUND` counts PR comments only. Sort each finding into **Address Now**, **Defer** or **Skip**. Truncate the deferrals file first, because `/tmp` outlives a worker and a retry would double every block:

```bash
DEFERRALS=/tmp/auto-implement-deferrals-<ID>.md
: > "$DEFERRALS"   # truncate once, here, at the start of triage
```

Append one `##` block per Defer item: the finding, file and line, why it is out of scope. A post-merge step this issue needs is a `kind: follow-up` block (`deferral.md` → Follow-ups) whose `why:` line names the rule or criterion; without one it is a finding. 6.4 appends here too.

### 4.5 Fix loop

Up to 3 attempts, each printing `[auto-implement] Fix attempt {attempt}/3`: fix every Address Now item, then

```bash
pnpm lint && pnpm type-check && pnpm test
```

Pass → leave. Third failure → stop with the failures: `[auto-implement] ✗ Error: Failed to fix issues after 3 attempts. Manual intervention required.`

```
[auto-implement] ✓ All checks passing
[branch-review:complete]
[auto-implement] Phase 4/7 complete → Proceeding to Phase 5
```

---

## Phase 5: Commit and Create PR

`[auto-implement] Phase 5/7: Creating commit and PR`

### 5.1 Stage changes

Everything pushed by 3.3 and `git status --porcelain` empty → 5.3. Otherwise stage by name, never `-A` or `.`, and leave out secrets:

```bash
git status --porcelain
git add src/components/MyComponent.tsx src/components/MyComponent.test.tsx
```

### 5.2 Create commit

```bash
git commit -m "$(cat <<'EOF'
type(scope): Subject line

Body explaining what and why.

<attribution trailer from the harness instructions>
EOF
)"
```

### 5.3 Analyze for PR description

```bash
git log origin/main..HEAD --format="%s%n%b"
git diff origin/main...HEAD --stat
```

### 5.4 Push and create PR

```bash
git push -u origin $(git branch --show-current)

gh pr create --title "type(scope): Subject" --body "$(cat <<'EOF'
## Context

[Why, from the Linear issue. Closes <ID>]

## Summary

- [Changes]
- **Follow-ups:** [`<follow-up ID> (Queued, blocked by <ID>)`, from the plan and 3.2. Omit if none.]

## Verified

- [What you ran and the result, naming the command, test, story or spec: "`pnpm test` — 4745 passed"]
- [One `Driven:` line per changed screen]

## Not verified

- [What could not be checked here, and why. `Nothing` if nothing.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

A failed commit, push or `gh pr create` → stop with its error.

**No checkboxes**: this cycle merges with every box open.

1. "Verified" holds only what you ran and saw pass.
2. No steps for a human. Assert a fact in a test or story play function and cite it; an uncheckable fact goes under "Not verified" with the reason.
3. "Not verified" states remaining risk; it is not a to-do list.
4. A post-merge step is in neither list: the merge does it, or it is a filed issue on the **Follow-ups** line.

```
[auto-implement] ✓ PR created: [URL]
[create-pr:complete]
[auto-implement] Phase 5/7 complete → Proceeding to Phase 6
```

---

## Phase 6: Address Reviews

`[auto-implement] Phase 6/7: Addressing reviews`

**Budget: 3 review rounds** (6.3 → 6.6). `ROUND` is the count of `<!-- claude-review -->` comments on the PR after 6.3, so earlier runs' rounds count. The cap bounds reviews, not merges.

Each round reviews before it waits for CI: the review does not need the CI result, so it runs while CI does.

### 6.1 Get PR info

```bash
gh pr view --json number,title,headRefName,url
```

### 6.2 Count earlier rounds

Run the 6.3 count before the reviewer, as `ROUND_BEFORE`. **`ROUND_BEFORE` ≥ 3 → skip the reviewer**: `ROUND = ROUND_BEFORE`, go to 6.4.

### 6.3 Trigger Claude review

Print `[auto-implement] Running Claude review for PR #${PR_NUMBER}...` and run it in the foreground, `timeout: 600000` (shorter leaves a stale lock). Past 600 s, background it and wait on the comment in this turn, as `batched.md` does.

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-review.sh ${PR_NUMBER}
```

Non-zero exit → stop: `[auto-implement] ✗ Error: Review script failed. Stopping to prevent merging without code review.`

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-comments.sh "$PR_NUMBER" issue \
  | jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
```

No number → failed fetch: stop. The count is `ROUND`. **`ROUND` must exceed `ROUND_BEFORE`**, or no review landed: `recovery.md` → Stale review lock. Never loop.

`[auto-implement] ✓ Claude review received (round ${ROUND}/3)`

### 6.4 Parse and triage review comments

Anchored inline comments (`line != null` drops earlier rounds' orphans), then the newest summary only:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-comments.sh "$PR_NUMBER" inline \
  | jq '[.[] | select(.body | startswith("**")) | select(.line != null)]'
./scripts/pr-comments.sh "$PR_NUMBER" issue \
  | jq -r '[.[] | select(.body | startswith("<!-- claude-review -->"))] | last | .body'
```

Empty output is a failed fetch (none prints `[]`): stop. On a re-reviewed PR, check each inline finding against the diff: an addressed one whose anchor moved still looks live.

- **No summary** → the review did not complete. Stop; it is not clean.
- **Clean** = "No issues found" **and** no inline comment **and** no `**Spec:**` entry → nothing to fix; 6.5 still waits for CI. A **"less usable"** `**Usability:**` verdict is a finding too.
- Every inline comment, and every finding in the summary (out-of-diff ones and those past the 5-comment cap live only there), is **Address Now**.
- **Each `**Spec:**` entry is Address Now.** A **Missing** or **Implemented but wrong** entry is a correctness defect at every round: never defer or drop it; if unfixable here, 6.7. An **Unproven** entry is fixed by a test that asserts the result, or by naming in the PR body the existing test, `Driven:` line or `measured:` Proof line that shows it. `**Spec:** no issue linked` / `issue not readable` are not findings.
- Otherwise use the rubric. **ROUND ≥ 3 → read `review-cap.md` → Materiality bar first.**

Append each round's Defer items and `kind: follow-up` blocks to `/tmp/auto-implement-deferrals-<ID>.md`: an earlier summary is unreadable once a later one posts.

### 6.5 Wait for CI, then fix

PR CI takes about 4-5 min. **Wait in foreground chunks**: CLAUDE.md → Working style → "Waiting inside a skill with a defined endpoint". No `run_in_background`, no background Agent, no Monitor. Each chunk runs with `timeout: 540000`:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/ci-settle.sh "$PR_NUMBER"
```

It polls about 8 minutes and prints one marker last; 6 chunks cover `ci.yml`'s 45 min timeout.

- `CI_WAITING`, or no marker → re-issue at once. Never end a turn here. A `Usage:` line on stderr (exit 2) means no PR number: report and stop.
- `CI_TIMEOUT` → report and stop. Do not merge.
- `CI_SETTLED` → verify in the same turn. Read the output: `--json` exits 0 on failures.

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
# A pending third-party commit status (empty workflow — Vercel) is exempt; a fail still blocks.
gh pr checks "$PR_NUMBER" --json name,bucket,state,workflow \
  --jq '.[] | select(.workflow != "" or .bucket != "pending") | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.state)"'
```

No output → passed. Any line → fix it in the pass below (`recovery.md` → CI-fix loop). `no checks reported` on stderr → `recovery.md` → No checks reported.

**One fix pass** takes this round's Address Now items and CI failures. Per Address Now item: take file and line from the inline comment, or find the site from the summary text; read it; fix it.

A **PR-body finding**: rewrite by the 5.4 rules, `gh pr edit <PR_NUMBER> --body-file <file>`. Close a "Not verified" gap with a test if you can; if not, keep the line and comment `not actioned: cannot be verified from this session — <reason>`, which settles it at any round.

A finding the round-3 bar drops gets a `not actioned:` note on every path (`review-cap.md`).

### 6.6 Commit and push fixes, then decide the round

**Always enter 6.6**: the decision routes every exit. If `git status --porcelain` shows changes:

```bash
git add [changed files]
git commit -m "$(cat <<'EOF'
fix: Address review feedback

<attribution trailer from the harness instructions>
EOF
)"
git push
```

After a push at `ROUND` ≥ 3, re-run the 6.5 wait and verification; a failure → `recovery.md` → CI-fix loop. Rule A's next round waits in its own 6.5. With nothing pushed, CI has settled. Then decide, first match wins:

- **Any round, a correctness or safety finding unresolved** → 6.7. Defer is for scope, not defects.
- **A. `ROUND` < 3, pushed** (review fixes, CI fixes, or both) → `[auto-implement] ✓ Round ${ROUND}/3 addressed and pushed → re-reviewing`, back to 6.2.
- **B. `ROUND` < 3, nothing changed** (all deferred, or a body-only edit) → no re-review of an identical diff: 6.8, Phase 7.
- **C. `ROUND` ≥ 3** → no 4th review. All resolved (fixed, or dropped with a note) → 6.8, Phase 7.

On B, or C with all resolved:

```
[auto-implement] ✓ Reviews addressed (round ${ROUND}/3)
[review-pr:complete]
[auto-implement] Phase 6/7 complete → Proceeding to Phase 7
```

### 6.7 Review-round cap reached: terminal hand-off

**Follow `review-cap.md` → 6.7 hand-off** (6.8 first, then the hand-off comments) and stop. No Phase 7.

### 6.8 File deferred findings and follow-ups

Every Phase 6 exit runs this; do not reprint 6.6's markers.

```bash
cat /tmp/auto-implement-deferrals-<ID>.md 2>/dev/null || echo "(no deferrals)"
```

Empty → `[auto-implement] No deferred findings to file`. Otherwise file by `deferral.md`; a failure never blocks the merge. Then from 6.7 return to 6.7; from anywhere else, Phase 7.

---

## Phase 7: Merge

`[auto-implement] Phase 7/7: Merging PR`

### 7.1 Pre-flight checks

```bash
git status --porcelain
gh pr view --json number,state,mergeable,mergeStateStatus,url
```

CLOSED → stop: "PR is closed. Cannot merge." Not mergeable → stop: "PR cannot be merged. Check conflicts".

### 7.2 Wait for CI

Re-run the 6.5 poll until terminal, then the 6.5 verification block in the same turn. `CI_TIMEOUT` → stop. No output → 7.3. **Any line → stop, do NOT merge**, a failed Vercel check included. No CI-fix loop: a push here would merge an unreviewed commit. `no checks reported` → `recovery.md`.

### 7.3 Merge the PR

The hook reads `WOBBLEPOT_ALLOW_MERGE=1` from the command text, so keep it inline. Worktree mode omits `--delete-branch`, because `gh` would check out main; GitHub deletes the remote branch.

```bash
WOBBLEPOT_ALLOW_MERGE=1 gh pr merge --squash
```

Non-zero exit → stop with the `gh` error: `[auto-implement] ✗ Error: Merge failed. PR left open.` No 7.4, no `[merge:complete]`.

### 7.4 Post summary to Linear

Use the literal PR number from 6.1:

```bash
gh pr view <PR_NUMBER> --json number,title,url,commits,files
./scripts/pr-comments.sh <PR_NUMBER> inline
./scripts/pr-comments.sh <PR_NUMBER> reviews
```

Fill `templates.md` → Linear summary comment. Its `### Proof` section takes one line per acceptance criterion, in the issue's order, from output the cycle already produced: the 3.2, 4.5 and 6.6 test runs, the `Driven:` lines, and the tests or lines an Unproven fix in 6.5 added. Run nothing new for it. Then:

```
mcp__linear-server__save_comment({ issueId: "<ID>", body: "[summary comment]" })
```

### 7.5 Local cleanup

None. `.github/workflows/neon-cleanup.yml` reaps the Neon branch on merge.

### 7.6 Report completion

Print `templates.md` → Filing report first when it applies, then:

```
[auto-implement] ✓ PR merged successfully
- Remote branch deleted
- Worktree branch preserved

To clean up this worktree:
  git worktree remove <worktree-path>

[merge:complete]
[auto-implement] ✓ Autonomous implementation cycle complete
```
