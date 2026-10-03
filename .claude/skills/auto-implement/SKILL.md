---
name: auto-implement
description: "Fully autonomous cycle for one Linear issue, through to merge: plan, implement, review, PR, address feedback, merge. Use only when the user says auto-implement or asks for the full unattended cycle. For 'implement HON-X' use /implement-issue."
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

Auto-discovery (no arg) reads the `Queued` state only, the same queue the orchestrator reads; Todo and Backlog are never picked up unattended (HON-854). It only surfaces issues `/auto-implement` can finish end-to-end — no new env vars, DNS, legal/design review, provisioning, or subjective human review (voice/taste/native-judgment work). See Phase 1, steps 1.2 and 1.5. When an issue ID is passed, the user's choice is respected without filtering.

## Execution Model

Execute phases 0-7 sequentially. Stop only on error or completion.

**Every turn must end in a terminal state — there is no pending-work exception.** In the orchestrator's headless spawn (`worktree-claude.sh auto` → `claude --dangerously-skip-permissions … "$prompt"`, no TTY, stdout redirected to a log) the process exits the moment a turn ends. There is no session left to deliver a `run_in_background` completion notification to, so backgrounded work dies with the process, the code meant to run "when the poll returns" never runs, and the orchestrator treats the run as finished and cleans up. That has both destroyed uncommitted work and stranded finished PRs (HON-562, HON-573; the incidents are in `history.md`).

So: never end a turn whose last message describes in-flight work in future tense ("CI is re-running — I'll merge once it settles" is exactly the sentence that stranded PR #651). The last message of a turn must be a phase marker, an explicit error stop, the **Phase 6.7 review-round-cap hand-off**, or the final completion marker.

The **6.7 hand-off** is a deliberate terminal state, not a failure. Phase 6 caps the review → fix → re-review loop at **3 rounds**; if the cap is reached with a correctness finding still unresolved, the PR is handed to a human instead of looping until an external budget kills the worker (HON-630).

**Backgrounding a command is allowed; ending the turn beside it is not.** When a command outruns Bash's 600 s foreground cap, you may start it with `run_in_background: true` — but the same turn must then *wait on it* with foreground wait-chunks until it reaches a terminal marker (the pattern in 6.1 and `batched.md`). A tool call in flight cannot end a turn, and the 600 s cap is per call, not per turn, so chained foreground waits cover an arbitrarily long job.

### Sibling files

Rarely-taken branches live next to this file, in `.claude/skills/auto-implement/`, and cost nothing on a run that never reaches them. Each section that moved keeps its heading here with a pointer saying which file to read and when. **When a pointer applies, read the file before acting** — its rules are not repeated here.

| File            | Read when                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `discovery.md`  | No issue ID was passed (Phase 1 auto-discovery)                                                  |
| `recovery.md`   | Retry context is present, the 2.1 gate stops, CI fails or reports no checks, a review does not post |
| `batched.md`    | The plan is split into batches, or a verification outruns the 600 s cap                          |
| `review-cap.md` | Review `ROUND` ≥ 3: the materiality bar, `not actioned:` notes, the 6.7 hand-off                 |
| `deferral.md`   | 6.8 finds deferred findings to file as `[AUTO DRAFT]` issues                                     |
| `history.md`    | Before changing or disputing a rule — the incidents behind them. Never needed to run a cycle     |

## Argument Parsing

Check if an issue ID was provided as argument:

- If argument matches `HON-XX` or just `XX` (numbers): Store issue ID, skip Phase 1
- If no argument: Run Phase 1 to find next unblocked issue

The issue ID is the **first token only**. On an orchestrator retry the arguments continue past it with a block that starts `Retry context:` — see [Retry context](#retry-context) below. Never read that block as part of the issue ID.

### Retry context

Present only on an orchestrator retry: the arguments continue past the issue ID with a block that starts `Retry context:` (HON-728). **If it is present, read `recovery.md` → Retry context before anything else.** It says where to resume (6.1, Phase 3, or a full cycle) and how the 2.1 gate treats the open PR.

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

Read `discovery.md` and run it. It holds 1.1 (project context), 1.2 (list unassigned `Queued` issues — Queued only, HON-854), 1.3 (re-fetch each candidate with `includeRelations: true`), 1.4 (hard filters), 1.5 (no-human-input filters, including the rejection of `[DRAFT]` and `[AUTO DRAFT]` titles), 1.6 (prioritise) and 1.7 (select, or exit normally with nothing to do), and prints the Phase 1 markers.

---

## Phase 2: Plan Implementation

```
[auto-implement] Phase 2/7: Planning implementation for HON-XX
```

### 2.1 Fetch issue details and gate

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract and note:

- Issue UUID (for API calls)
- Title and description
- `gitBranchName` for later use
- `blockedBy` relations
- `blocks` relations (what this unblocks)
- `relatedTo` / `parentId` (for overlap check in 2.3)
- Current `assignee`
- Any labels or priority

**Hard gate — run three checks in this order (status → assignee → blockers) and stop at the first failure.** An explicit `HON-XX` skips Phase 1, so this is the only filter on that path. The orchestrator pre-claims: `claim_issue()` in `scripts/orchestrator.sh` sets the state to `In Progress` and leaves the assignee empty before it spawns the worker, so `In Progress` + unassigned is the normal case, not a conflict.

1. **Status** — gate on `statusType`, not on the display name. `backlog` / `unstarted` (Backlog, Todo, Queued) pass. `started` passes only as `In Progress`, subject to the assignee check; `In Review` stops, except on an orchestrator retry whose open PR is on this branch (`recovery.md` → Retry context). `completed`, `canceled`, `duplicate` and `triage` stop.
2. **Assignee** — resolve yourself once with `mcp__linear-server__get_user({ query: "me" })`. Pass if `assignee` is `null`, or its id (`assigneeId` / `assignee.id`) matches yours; compare display names only when `get_issue` returns no id.
3. **Blockers** — `relations.blockedBy` entries carry no status, so re-fetch each with `mcp__linear-server__get_issue({ id, includeRelations: true })`. Pass if `blockedBy` is empty or every blocker's `statusType` is `completed` / `canceled`.

**On any stop, read `recovery.md` → Gate stops before printing anything.** A stop must first undo the orchestrator's pre-claim, or the issue is stranded `In Progress` where nothing picks it up again; that section has the undo rule, the stop messages, and what to do with a `Duplicate` blocker.

### 2.2 Claim issue

Immediately after the gate passes — before any planning work — set status to "In Progress" and assign to self. On the orchestrator's first attempt this fills in the assignee that `claim_issue()` left empty; on a direct `/auto-implement HON-XX` invocation it is the actual claim that keeps other agents off the issue. (`In Review` never reaches this step — see the status check.)

```
mcp__linear-server__save_issue({ id: "HON-XX", state: "In Progress", assignee: "me" })
```

### 2.3 MANDATORY: Check relatedTo + epic siblings for recently-merged overlap

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

Read the files the plan depends on, not the whole codebase.

**If the issue changes a shared primitive's geometry** (a size/height/padding/radius default under `src/components/ui/*.tsx`, a `@theme` token, or a shared layout wrapper default): run the coupling scan from `/plan-issue` step 7b — this skill inlines its own planning phase, so 7b does not otherwise fire here — and record the result as a `## Coupled callsites` section in the 2.7 plan, grouped Mirror / Override / Deliberate. Write an explicit `none — no callsite hardcodes the changed <property>` if it found nothing.

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

## Coupled callsites

[From the step 7b scan in 2.6. Group by Mirror / Override / Deliberate with a `file:line` and a one-line reason each — the Deliberate bucket is only useful with the reason. If the scan ran and found nothing, write `none — no callsite hardcodes the changed <property>`, naming the property scanned; without that branch a clean scan is indistinguishable from one that never fired. Omit entirely only if the issue changes no primitive geometry, `@theme` token, or shared layout wrapper.]

## Verification

- [One line per acceptance criterion: the command, test, story or spec you will run to show it holds]
- [Edge cases, and the test that covers each]
```

`## Verification` is a plain list, not checkboxes, of what **you** will run. It becomes the PR's "Verified" list in 5.4, so a step only a human could perform does not belong here; if a criterion cannot be checked from this session, say so, and it goes under "Not verified".

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
6. If the 2.7 plan has a `## Coupled callsites` section, work it like the implementation steps — it is a sibling of `## Implementation Steps`, not a member, so nothing else will pick it up. Every **Mirror** must be edited in this phase; leaving them for the 4.3 review bullet reproduces the find-it-in-review failure this scan exists to prevent

### 3.3 Batched plans: commit and push per batch

When the plan splits the work into sequential batches (dependency refreshes, migration series, multi-step refactors), or a verification will outrun Bash's 600 s cap (`pnpm test:e2e:local`, a large `pnpm test-storybook:ci` run), **read `batched.md` first.** Each batch is committed and pushed as soon as its fast gate passes, and long verification is waited on through a marker file in the same turn.

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
- **Shared-primitive coupling**: If the diff changes a geometry default on a primitive under `src/components/ui/*.tsx`, a `@theme` token, or a shared layout wrapper, run `/plan-issue` step 7b's greps against the **old** literal and confirm every Mirror moved with it. Skeletons are the usual miss — HON-612 desynced 12 route `loading.tsx` files this way and review, not planning, caught it (CLAUDE.md shared-primitive geometry rule)

### 4.4 Triage issues

Using **effort-first** thinking:

- Quick fix (< 5 min) → **address now**
- Moderate fix (15-30 min, in scope) → **address now**
- Significant work (hours) → defer only if truly out of scope

Categories:

- **Address Now**: Fix before PR merge
- **Defer**: Only for significant out-of-scope work
- **Skip**: Disagree or not actionable

**Truncate `/tmp/auto-implement-deferrals-HON-XX.md`, then append every Defer item to it as you triage.** Truncate first, unconditionally — `scripts/orchestrator.sh` retries a failed worker once on the same issue, `/tmp` outlives the worktree teardown, and 2.1 passes that retry through, so an append-only file doubles every block on the second attempt and spends the 3-issue cap on copies that 6.8's Linear duplicate check cannot catch (they are not filed yet).

```bash
DEFERRALS=/tmp/auto-implement-deferrals-HON-XX.md
: > "$DEFERRALS"   # truncate once, here, at the start of triage
```

Write one `##`-headed block per item, carrying enough for 6.8 to file it without this conversation: the finding, the file and line, and why it was out of scope.

This file is the **single sink for every deferral in the run** — 6.4 appends to it each round as well. Phase 5, the CI waits and up to three review rounds sit between here and 6.8, so do not rely on in-context state to carry deferrals across that span.

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

If the plan was batched (Phase 3.3) and every batch is already committed and pushed, there may be nothing left to stage — verify with `git status --porcelain` and skip to 5.3.

List changed/untracked files and stage them by name. Do NOT stage with a catch-all (`git add` with `-A` or `.`).

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

<attribution trailer from the harness instructions>
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

## Verified

- [What was run or asserted, and the result. Name the command, test, story or spec: "`pnpm test` — 4745 passed", "`CookieBanner.stories.tsx` › PhoneWithTabBar asserts the 80px offset", "Tier 1 E2E green on the PR".]

## Not verified

- [What could not be checked from here, and why: needs credentials, needs a real device, needs a paid API call, only observable after merge. Write `Nothing` if there is nothing.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**No checkboxes anywhere in a PR body.** Nobody ticks them: this cycle merges with every `- [ ]` still open, so a box addressed to a human is addressed to nobody (HON-860). Write the two lists by these rules:

1. A line goes under "Verified" only if you ran it and saw the result. Intent is not verification.
2. Do not write a step for a human to perform. If a fact can be asserted, assert it in a test or a story play function and cite that under "Verified". If it cannot be checked at all, it goes under "Not verified" with the reason.
3. "Not verified" is not a to-do list and creates no follow-up by itself. It is a statement of remaining risk.
4. A step that must happen after merge (restart a process, run a workflow) is not a PR line at all: the merge step performs it, or it is a Todo issue assigned to a human, per CLAUDE.md → "Queued is the queue".

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

### Review-round budget — hard cap of 3 rounds

Phase 6 is the only loop in this skill: 6.3 reviews, 6.4 triages, 6.5 fixes, 6.6 pushes and comes back to 6.3 for the next round. Its natural exit — "the reviewer runs out of findings" — only exists when there is an oracle (a failing test, a type error, a broken selector). On a prose or heuristic deliverable there is always another defensible finding, so the loop has to be bounded (HON-627 ran 14 rounds; the numbers are in `history.md`).

**ROUND is the number of `<!-- claude-review -->` comments on the PR once 6.3 has posted the current one.** It is read from GitHub rather than a local counter, so it survives process death and context summarization, and it counts rounds this run did not perform (a manual `/review-pr`, an earlier worker on the same branch). 6.3 requires `ROUND` to be **strictly greater** than the count taken before the run and stops the cycle if it is not, which is what makes each round consume budget.

**The cap bounds reviews, not merges.** Round 3's findings can still be fixed and shipped; what the cap forbids is asking for a *fourth opinion* on the result.

Every round ends in exactly one of these, and only the second one re-enters 6.3:

| Outcome of the round                                                                   | Next                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Clean review — summary says "No issues found" **and** the anchored inline list is empty | 6.8 → Phase 7, merge (6.4)                                              |
| `ROUND` < 3, findings addressed and pushed                                             | back to 6.3 for the next round (6.6 branch A)                           |
| `ROUND` < 3, nothing changed — every finding deliberately deferred                     | never re-review an identical diff → 6.8 → Phase 7, merge (6.6 branch B) |
| `ROUND` ≥ 3, everything resolved (fixed, or dropped by 6.4's bar with a note)           | 6.8 → Phase 7, merge — no 4th review (6.6 branch C)                     |
| `ROUND` ≥ 3, a correctness/safety finding still unresolved                             | 6.8 → **6.7 terminal hand-off** — PR left open for a human (6.6 branch C) |

`./scripts/pr-review.sh` is therefore invoked at most 3 times in Phase 6, and 6.1's CI-fix loop is separately capped at 2 attempts, so no path through Phase 6 runs a 4th round.

### 6.1 Wait for CI

CI takes 12–45 min. Bash's 600 s cap is per *call*, not per turn, so wait in **foreground chunks**: each call polls for ~8 min and returns a marker, and you re-issue it until the marker is terminal. Do not background this poll — in the headless spawn the process exits when the turn ends and a backgrounded poll dies with it, which is exactly how PRs #650 and #651 were stranded open (see Execution Model).

Run the block below in the **foreground** with `timeout: 540000`:

```bash
# One chunk = 16 polls, 15 sleeps × 30 s ≈ 480 s of sleep (510 s on chunk 1,
# which also waits for GitHub to register the run) plus ~18 gh calls — under the
# prescribed 540 s timeout with room to spare. The 16th sleep is skipped on
# purpose: it would only delay CI_WAITING, and it is what used to push chunk 1
# past the cap, where the call is killed and prints no marker at all.
# Prints exactly one marker on its last line:
#   CI_SETTLED  → terminal — proceed to the foreground verification below
#   CI_WAITING  → NOT terminal — re-issue this exact command (budget: 6 chunks ≈ 48 min,
#                 which covers ci.yml's timeout-minutes of 45)
#   CI_TIMEOUT  → terminal — report and stop
# Settles only when: at least one non-exempt check exists (a docs-only PR is allowed none)
# and none is pending; the sorted name=bucket list is identical on two consecutive polls
# (fast Vercel/smoke statuses register before the ci.yml job does); and, unless the PR
# is affirmatively classified docs-only, the ci.yml job "Lint, Type Check & Test" is
# present. Affirmatively: a file list that could not be read is not a docs-only PR, so
# it still requires the job (HON-587) — do not weaken this back to "has non-docs files",
# which is also true of an unreadable list and waives the only build gate there is. Each Bash call is a
# fresh shell, so PR_NUMBER is re-derived here and the previous poll's result is carried
# across chunks in a file — never reuse a shell variable.
PR_NUMBER=$(gh pr view --json number --jq .number)
# NOT `gh pr view --json files`: it hardcodes `files(first: 100)` and has no
# --paginate, so a >100-file PR whose first 100 paths are docs would read as
# DOCS_ONLY and settle a code PR on no CI at all (HON-587). The REST endpoint
# paginates; `--jq` runs per page, so the slurp uses the system jq (HON-586).
# The field is `filename` here — GraphQL's `path` does not exist on this payload
# and would yield one `null` per file, matching no docs pattern.
FILES=$(gh api --paginate "/repos/:owner/:repo/pulls/$PR_NUMBER/files?per_page=100" | jq -rs 'add | .[].filename')
# A partial walk fails open exactly like the 100-cap did: gh streams each page as it
# arrives and the pipeline reports jq's status, not gh's, so a 502 on page 2 of a
# 150-file code PR leaves 100 docs paths that read as DOCS_ONLY. Only a >100-file PR
# paginates at all, so the exposure is precisely the population this fetch exists for.
# changedFiles is a scalar total and is not paginated; a mismatch — or a failed count,
# which can equal nothing — empties FILES into the guard below, the same closing move
# scripts/pr-review.sh:272 already makes.
CHANGED=$(gh pr view "$PR_NUMBER" --json changedFiles --jq '.changedFiles' 2>/dev/null)
[ "$(printf '%s\n' "$FILES" | grep -c .)" = "$CHANGED" ] || FILES=""
NON_DOCS=$(printf '%s\n' "$FILES" | grep -Ev '\.md$|^docs/|^\.github/ISSUE_TEMPLATE/')
# ci.yml is paths-ignored for docs, and Preview smoke only fires on a SUCCESSFUL
# Vercel deploy — so a docs-only PR whose Vercel status is stuck has no other
# check at all, and exempting that one row leaves the list legitimately empty.
# Requires a non-empty FILES: a fetch that failed must never read as "docs-only,
# nothing to wait for" and settle a code PR on zero checks. An empty fetch makes
# `jq -s 'add'` yield null and `.[]` error out, so FILES lands empty either way.
DOCS_ONLY=false; [ -n "$FILES" ] && [ -z "$NON_DOCS" ] && DOCS_ONLY=true
PREV_FILE="/tmp/ci-poll-$PR_NUMBER.prev"; CHUNK_FILE="/tmp/ci-poll-$PR_NUMBER.chunks"
# Reap state left by an abandoned episode (a killed call, a worker timeout).
# It is keyed only by PR number, so a RETRY worker on the same PR would inherit
# the spent budget — 2 chunks instead of 6 — and hit CI_TIMEOUT on CI that was
# always going to take 30 min, re-stranding the PR through the state file. A
# stale PREV is worse: it can match the first CUR and settle the poll without
# ever running the two-consecutive-poll stability check. A live episode
# re-issues within seconds, so age separates the two cleanly.
[ -n "$(find "$CHUNK_FILE" -mmin +10 2>/dev/null)" ] && rm -f "$PREV_FILE" "$CHUNK_FILE"
CHUNKS=$(( $(cat "$CHUNK_FILE" 2>/dev/null || echo 0) + 1 )); echo "$CHUNKS" > "$CHUNK_FILE"
# INIT is a sentinel no check list can equal: without it an empty CUR would match
# an empty PREV and settle on the very first poll, skipping the stability check.
PREV=$(cat "$PREV_FILE" 2>/dev/null || echo INIT)
[ "$CHUNKS" = 1 ] && sleep 30  # let GitHub register the workflow run for the pushed commit
for i in $(seq 1 16); do
  # A third-party commit status (empty workflow — Vercel) is exempt while pending:
  # it can stick after the deploy is Ready (HON-600). A fail still blocks: CI runs
  # no `next build`, so Vercel is the only build gate.
  CUR=$(gh pr checks "$PR_NUMBER" --json name,bucket,workflow \
    --jq 'sort_by(.name) | .[] | select(.workflow != "" or .bucket != "pending") | "\(.name)=\(.bucket)"' 2>/dev/null)
  OK=1
  [ -n "$CUR" ] || [ "$DOCS_ONLY" = true ] || OK=0                                   # at least one check (docs-only may have none)
  printf '%s\n' "$CUR" | grep -q '=pending$' && OK=0                                 # none pending
  [ "$DOCS_ONLY" = true ] || printf '%s\n' "$CUR" | grep -q '^Lint, Type Check' || OK=0   # ci.yml job registered (code PRs)
  [ "$CUR" = "$PREV" ] || OK=0                                                       # identical to the previous poll
  PREV=$CUR; printf '%s' "$CUR" > "$PREV_FILE"
  if [ "$OK" = 1 ]; then rm -f "$PREV_FILE" "$CHUNK_FILE"; echo CI_SETTLED; exit 0; fi
  [ "$i" -lt 16 ] && sleep 30   # the 16th sleep would only delay CI_WAITING
done
if [ "$CHUNKS" -ge 6 ]; then rm -f "$PREV_FILE" "$CHUNK_FILE"; echo CI_TIMEOUT; exit 1; fi
echo "CI_WAITING (chunk $CHUNKS/6)"
```

Act on the marker:

- `CI_WAITING` — re-issue the same command immediately. **This is not a stopping point.** Never end a turn on it, and never write a message like "CI is still running, I'll merge once it settles" — that sentence is the bug this pattern exists to prevent.
- **No marker at all** (the Bash call was killed at its timeout, or errored before the loop) — treat it exactly as `CI_WAITING` and re-issue. The chunk counter was already incremented, so the budget shrinks by one and a repeat lands on `CI_TIMEOUT` rather than looping forever. A missing marker is never a reason to end the turn.
- `CI_TIMEOUT` — terminal: report and stop. Do not merge.
- `CI_SETTLED` — continue to the verification below.

On `CI_SETTLED`, verify in the same turn. With `--json`, `gh pr checks` exits 0 even when checks failed or were cancelled, so the `bucket` field is the only signal — anything other than `pass`/`skipping` (`fail` or `cancel`: FAILURE, CANCELLED, TIMED_OUT, ERROR) is a failure. The one exemption matches the poll's: a still-`pending` third-party commit status (empty `workflow`) does not block, because it can stick forever after the deploy is Ready:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
# A third-party commit status (empty workflow — Vercel) is exempt while pending:
# it can stick after the deploy is Ready (HON-600). A fail still blocks: CI runs
# no `next build`, so Vercel is the only build gate.
gh pr checks "$PR_NUMBER" --json name,bucket,state,workflow \
  --jq '.[] | select(.workflow != "" or .bucket != "pending") | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.state)"'
```

- No output → all checks passed. Proceed.
- Any line printed → CI is failing (check names and states listed).
- `no checks reported on the '<branch>' branch` on stderr (exit 1) → read `recovery.md` → No checks reported. It decides whether the PR is docs-only (treat as passed) or must stop.

If CI fails, read `recovery.md` → CI-fix loop: at most 2 fix attempts, each re-running the wait above, then stop.

### 6.2 Get PR info

```bash
gh pr view --json number,title,headRefName,url
```

### 6.3 Trigger Claude review

Spawn a fresh Claude Code session to review the PR. **You MUST use the script below — do NOT inline the review prompt or spawn claude directly.** The script handles model selection (`REVIEW_MODEL` from `scripts/models.sh`, overridable with `CLAUDE_REVIEW_MODEL`), locking, and prompt formatting.

**First record the marker count as `ROUND_BEFORE`**, using the same fetch as the verification below. The cap counts rounds by these markers, so the count has to be shown to *increase* — see the check after the run.

**Gate on it before spending a round: if `ROUND_BEFORE` ≥ 3, do not run the reviewer at all.** The cap is on reviews, and a review that has not started yet is the only one that is free to skip. A PR can arrive here already carrying three markers — a manual `/review-pr`, or an earlier worker on the same branch — and invoking the script anyway spends a 4th `claude -p` round before 6.6 can notice, which is exactly the "no 4th round" guarantee the budget section makes. In that case set `ROUND = ROUND_BEFORE`, skip to **6.4** and triage the findings already on the PR under the round-3 materiality bar; 6.6 branch C then routes it.

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-review.sh ${PR_NUMBER}
```

This runs synchronously. When it returns, the review has been posted to GitHub. It spawns `claude -p` and takes several minutes — run it in the **foreground** with `timeout: 600000`; the default 120 s Bash timeout kills it mid-run and leaves a stale `/tmp/claude-review-N.lock`. If it ever outruns 600 s, background it and wait on the `<!-- claude-review -->` comment with foreground wait-chunks in the same turn (the `batched.md` pattern) — never end the turn beside it.

```
[auto-implement] Running Claude review for PR #${PR_NUMBER}...
```

Verify the review was posted:

```bash
# --paginate + `jq -s 'add'`: without it the API returns only the first page (30 by default), and --jq cannot be used because gh applies it per page (HON-586).
gh api --paginate '/repos/:owner/:repo/issues/{number}/comments?per_page=100' \
  | jq -s 'add | [.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
```

Substitute the literal PR number for `{number}` — `gh api` expands only `{owner}` / `{repo}`.

**That count is `ROUND`.** Note it: 6.4 branches on it for the materiality bar and 6.6 branches on it for the cap. It is the total number of review rounds this PR has had, not just the ones this run performed, which is the quantity the cap is meant to bound.

**`ROUND` must be strictly greater than `ROUND_BEFORE`. If it is not, stop — never loop.** `ROUND == ROUND_BEFORE` at any count, including a non-zero one, means no new review landed — usually a stale `/tmp/claude-review-${PR_NUMBER}.lock` that made the script exit 0 without reviewing. Proceeding would triage the previous round's findings as current and loop on them forever. Read `recovery.md` → Stale review lock for the stop message, and do not proceed to 6.4.

```
[auto-implement] ✓ Claude review received (round ${ROUND}/3)
```

If the review script fails (non-zero exit):
```
[auto-implement] ✗ Error: Review script failed. Stopping to prevent merging without code review.
Stop here (non-zero exit)
```

### 6.4 Parse and triage review comments

Fetch the inline review comments posted by the reviewer, dropping any that are no longer anchored:

```bash
# --paginate is mandatory: without it the API returns only the first page, and
# GitHub orders comments oldest-first, so the newest round is the page that gets
# dropped. --jq is deliberately NOT used: gh applies it per page, so `| length` /
# `| last` would emit one result per page. `jq -s 'add'` folds the stream into a
# single array first. Do not "simplify" this back to --jq (HON-586).
#
# Do NOT add an `add // []` fallback either. A PR with genuinely zero comments
# already yields `[]` here; `// []` would only ever fire when the fetch itself
# produced no output at all (network, auth, rate limit) — turning a failed fetch
# into a confident "no findings", which is the exact bug this call site is
# guarding against.
#
# What makes THIS site loud is the `[.[] | …]` below it: `add` over an empty slurp
# is `null`, and iterating null is a jq error (exit 5). Bare `add` on its own is
# NOT loud — it prints `null` and exits 0 — so the two gather-only fetches in 7.4
# spell the guard out with `// error(...)` instead. Uses the system `jq` binary,
# not gh's embedded one.
gh api --paginate '/repos/:owner/:repo/pulls/{number}/comments?per_page=100' \
  | jq -s 'add | [.[] | select(.body | startswith("**")) | select(.line != null)]'
```

`select(.line != null)` is required: if a PR has been reviewed more than once, the earlier round's comments are still on the PR, and GitHub orphans them at `line: null` once the code they pointed at moves. Without the filter, 6.5 tries to open a file at a null line (HON-585).

**Known limitation:** an earlier round's finding that was addressed but whose anchor merely shifted keeps `line != null` and looks live; neither `commit_id` nor `isResolved` / `isOutdated` tells it apart (HON-585). On a re-reviewed PR, check each inline finding against the diff before "fixing" it.

Also fetch the summary comment — **the most recent one only**, since each review round appends its own:

```bash
# --paginate + `jq -s 'add'`: without it the API returns only the first page (30 by default), and --jq cannot be used because gh applies it per page (HON-586).
gh api --paginate '/repos/:owner/:repo/issues/{number}/comments?per_page=100' \
  | jq -rs 'add | [.[] | select(.body | startswith("<!-- claude-review -->"))] | last | .body'
```

Dropping `| last` concatenates every round, so the "No issues found" check below would be judged against a mixture of verdicts from different commits.

**Triage rules:**

The reviewer only posts substantive issues (no nitpicks), so triage is simpler:

- **If the fetch returns no summary at all** → the review did not complete. Do not read this as clean; stop and report, matching 6.3's warning. An absent summary and a clean summary are not the same thing.
- If the latest summary contains "No issues found" **and** the anchored inline list is empty → clean review, skip to 6.8 (Phase 4 may still have left deferrals to file), then Phase 7. One exception: on a documentation-only PR the summary also carries a `**Usability:**` verdict, and a **"less usable"** verdict is a finding no matter what the rest of the summary says. Treat it as an Address Now item — cut what the verdict names — rather than a clean review. `scripts/pr-review.sh` tells the reviewer not to pair the two, but the merge decision is made here, so do not depend on that.
- Every anchored inline review comment → **Address Now** (they are all substantive by design)
- **Always read the latest summary body for findings too**, not only when the inline list is empty. `scripts/pr-review.sh` puts out-of-diff findings and anything past its 5-comment inline cap in the summary alone, so summary-only findings routinely arrive *alongside* inline ones. They are Address Now items as well.
- Never merge on an empty inline list alone.
- Use effort-first thinking for prioritization:
  - Quick fix → address now
  - Moderate fix → address now
  - Significant work → defer if genuinely out of scope

**From ROUND 3 on, read `review-cap.md` → Materiality bar before triaging.** The bar rises: only correctness and safety defects are actioned, and every finding it drops gets a `not actioned:` note in 6.5. On rounds 1 and 2 every substantive finding is an Address Now item, per the rules above.

**Append every Defer item to `/tmp/auto-implement-deferrals-HON-XX.md`** — the same file 4.4 truncated and started — in the same `##`-headed block format, as you triage each round. Do not plan to re-read them from the PR at 6.8: the summary fetch above ends in `| last` by design, so a summary-only deferral from round 1 or 2 is unreadable once round 3 has posted, and `scripts/pr-review.sh` puts out-of-diff findings and anything past its 5-comment inline cap in the summary alone. Appending each round is what makes those survive to 6.8.

### 6.5 Address review comments

For each item in "Address Now":

- For an inline comment: extract file path and line number — 6.4's `select(.line != null)` guarantees both are present
- For a summary-only finding: there are no coordinates, so locate the site yourself from the finding's description before editing
- Read the file at that location
- Apply the suggested fix using Edit tool

A **PR-body finding** (a checkbox, a "Verified" line that cites nothing, a "Not verified" gap) has no file to edit. Rewrite the body under the 5.4 rules with `gh pr edit <PR_NUMBER> --body-file <file>`. For a "Not verified" gap, close it with a test instead where you can, and move the line to "Verified" once it passes. If nothing in this session can check it, keep the line with its reason (never delete it to clear the finding) and post an issue-level comment, with the summary-only command in `review-cap.md` → `not actioned:` convention, whose body starts with the literal prefix `not actioned: cannot be verified from this session — <reason>` instead of the coverage-only one. That settles the finding at any round; it is not an unresolved correctness finding for 6.6.

**A finding the round-3 materiality bar drops needs a `not actioned:` note**, posted here in 6.5 on every path, including the one that merges: a reply on the inline comment, or one issue-level comment covering every summary-only drop in the round. The commands and the literal prefix are in `review-cap.md` → `not actioned:` convention.

### 6.6 Commit and push fixes, then decide the round

**Always enter 6.6, even when 6.5 changed nothing.** Only the commit-and-push half below is conditional; the round decision after it is what routes every path out of Phase 6, so skipping the step on "no fixes were made" skips the merge-vs-hand-off decision with it.

#### Commit and push — only if fixes were made

```bash
git status --porcelain
```

If changes exist, stage specific changed files by name:

```bash
git add [changed files]
git commit -m "$(cat <<'EOF'
fix: Address review feedback

<attribution trailer from the harness instructions>
EOF
)"
git push
```

Wait for CI again — re-run the 6.1 foreground wait-chunk + verification, re-issuing on `CI_WAITING` until a terminal marker. Do not end the turn here. (Nothing pushed means no new head, so CI has already settled — skip straight to the decision.)

#### Then decide the round — this part always runs

The commit above is conditional on 6.5 having changed something. **The decision below is not**: run it on every pass through 6.6, including one where nothing was committed. `ROUND` is from 6.3; "fixes were pushed" means the commit above exists.

**A. `ROUND` < 3 and fixes were pushed** → go back to **6.3** and run the next review round against the new head.

```
[auto-implement] ✓ Round ${ROUND}/3 addressed and pushed → re-reviewing
```

**B. `ROUND` < 3 and nothing changed** — every finding was deferred as genuinely out of scope. A re-review would return the identical findings against the identical diff, so never loop back to 6.3 here. Proceed to **6.8** — this is the branch with the most to file, since it fires precisely when every finding was deferred — and then to Phase 7 and merge: the defer was deliberate, and the diff the reviewer saw is the diff being merged. A round whose only fix was a PR-body edit (6.5) also lands here: the diff is unchanged, so a re-review has nothing new to judge.

> **An unresolved correctness or safety finding routes to 6.7 at any round, not just at the cap.** 6.4's "significant work → defer if genuinely out of scope" covers scope, not defects, and the rule must not depend on which round the defect surfaced in: handing one to a human on round 3 while merging the identical one on round 1 would make "defer everything immediately" the cheapest and least supervised way out of Phase 6. Deferring is for work that belongs in another issue. If a correctness or safety finding is real and simply unfixed, go to **6.7** and say so under "Still open".

**C. `ROUND` ≥ 3 — the cap.** Never run a 4th review, whether or not fixes were pushed. The cap bounds *reviews*, not merges, so what happens next depends on whether anything is still unresolved:

- **Every finding resolved** — the material ones fixed and pushed, the coverage-only ones dropped by 6.4's bar with a `not actioned:` note — → **6.8, then Phase 7, merge.** Round 3's fix ships without a 4th review; stranding these would only walk the orchestrator toward `MAX_CONSECUTIVE_FAILURES` (`history.md`).
- **A correctness or safety finding is still unresolved** — too large to fix in scope, or it needs a decision this run should not make alone — → **6.7 hand-off.** This is the case the issue means by "listing the unaddressed findings": a human resolves what a 4th round would otherwise have chased.

Print the block below on branch B, or on branch C with everything resolved. Branch A goes back to 6.3, and branch C with something unresolved goes to 6.7 and prints its own markers. (6.4's clean-review exit skips 6.6 entirely and prints this block itself on its way to Phase 7.)

```
[auto-implement] ✓ Reviews addressed (round ${ROUND}/3)
[review-pr:complete]
[auto-implement] Phase 6/7 complete → Proceeding to Phase 7
```

### 6.7 Review-round cap reached — terminal hand-off

Reached only from 6.6 branch C, when a **correctness or safety finding is still unresolved** at the cap. **Read `review-cap.md` → 6.7 hand-off and follow it:** run 6.8 first, post the hand-off comment on the PR and on the issue, leave the Linear state alone, print the hand-off markers and stop. Do not proceed to Phase 7.

### 6.8 File deferred findings as `[AUTO DRAFT]` issues

Runs on every exit from Phase 6: 6.4's clean-review exit, 6.6 branch B, 6.6 branch C with everything resolved, and the 6.7 hand-off, which comes here before posting its comment. 4.4's deferrals reach every one of those paths, so a clean PR review alone does not make this a no-op. When 6.8 is reached via 6.6, do not print 6.6's markers again.

```bash
cat /tmp/auto-implement-deferrals-HON-XX.md 2>/dev/null || echo "(no deferrals)"
```

- **Nothing deferred** → print `[auto-implement] No deferred findings to file` and leave by the exit below.
- **Anything deferred** → read `deferral.md` and file per its rules: the `[AUTO DRAFT]` prefix, `Backlog`, a duplicate check first, at most 3 issues per cycle. A filing failure never blocks the merge.

**Then leave by the door you came in.** Entered from 6.7 → go back to 6.7, post the hand-off with the filed IDs, print its markers and stop; **do not continue to Phase 7**. Entered from any other path → continue to Phase 7 and merge.

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

Same mechanism and the same two blocks as 6.1. Re-run the 6.1 poll in the **foreground** with `timeout: 540000`, re-issuing on `CI_WAITING` or a missing marker until it is terminal, then run the 6.1 verification block in the same turn. Never background this poll and never end the turn beside it. `CI_TIMEOUT` → report and stop; do not merge. Verification prints nothing → proceed to 7.3. Verification prints any line → **STOP — do NOT merge.** Report the listed checks; do not enter the 6.1 CI-fix loop here, because a push in Phase 7 would merge a commit no review round has seen. A `no checks reported` stderr → `recovery.md` → No checks reported.

**Do NOT merge if the verification prints any line** — any check in the `fail` or `cancel` bucket, including Vercel deployment checks. This is a hard gate, no exceptions: `ci.yml` runs no `next build`, so a failed Vercel deploy is the only build gate there is; only a *pending* third-party status is exempt (HON-600; its accepted residual risk is in `history.md`).

### 7.3 Merge the PR

The `WOBBLEPOT_ALLOW_MERGE=1` prefix is required: `.claude/hooks/block-destructive.mts` blocks every `gh pr merge` without it (HON-727). Keep it inline on the same command — the hook reads it from the command text, so an `export` in an earlier Bash call does not carry over.

**Detect environment first** (reuse from Phase 0):

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

**Regular repo mode:**

```bash
WOBBLEPOT_ALLOW_MERGE=1 gh pr merge --squash --delete-branch
```

**Worktree mode:**

`gh pr merge --delete-branch` fails in worktrees because `gh` tries to checkout main internally, which conflicts with the parent worktree. Use without `--delete-branch`:

```bash
WOBBLEPOT_ALLOW_MERGE=1 gh pr merge --squash
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
# `files` is capped at 100 here and left that way on purpose (HON-587): this list is
# cosmetic, and truncating a changelog is not a merge gate. The docs-only decision
# in 6.1/7.2 reads the paginated REST endpoint instead.
gh pr view <PR_NUMBER> --json number,title,url,commits,files

# Review comments: inline comments + review-level summaries
# (`:owner/:repo` is auto-filled by gh from the current git remote)
# --paginate + `jq -s 'add'`: without it the API returns only the first page (30 by default), and --jq cannot be used because gh applies it per page (HON-586).
# `// error(...)` is the loud-failure guard: unlike the filtered fetches in the review
# phase, bare `add` returns `null` (exit 0) on empty stdout, which would read as "no
# comments". A genuinely empty `[]` still passes — only null/false are falsy to `//`.
gh api --paginate '/repos/:owner/:repo/pulls/<PR_NUMBER>/comments?per_page=100' | jq -s 'add // error("fetch produced no output")'
gh api --paginate '/repos/:owner/:repo/pulls/<PR_NUMBER>/reviews?per_page=100'  | jq -s 'add // error("fetch produced no output")'
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

**Neon branch cleanup:** No action needed here. `.github/workflows/neon-cleanup.yml` is the source of truth — it fires on `pull_request.closed` with `merged == true` and reaps the paired `auto--hon-<N>` Neon branch. A daily sweep catches anything that escapes, including `preview/*` branches the Vercel–Neon integration re-creates after merge. See [`docs/RUNBOOKS/neon-branch-gc.md`](../../../docs/RUNBOOKS/neon-branch-gc.md).

### 7.6 Report completion

If 6.8 filed anything, skipped a duplicate, hit the 3-issue cap, or failed to file, say so before the mode-specific block — this is the only place the operator sees it without opening Linear:

```
Deferred findings:
- Filed: HON-AA, HON-BB
- Already tracked: HON-CC (skipped as duplicate)
- Not filed (over cap): [one line per remaining finding]
```

Omit the block entirely only when 6.8 had nothing to file — a clean PR review is not sufficient, since 4.4's deferrals reach 6.8 on that path too.

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
| 6     | Review-round cap reached (3)    | 6.7 hand-off — terminal, not an error: PR left open with a summary comment, not merged |
| 6.8   | `save_issue` fails twice        | Warn, print body, continue |
| 7     | Merge fails                     | Stop, show error       |
