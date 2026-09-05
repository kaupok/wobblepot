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

**Every turn must end in a terminal state — there is no pending-work exception.** In the orchestrator's headless spawn (`worktree-claude.sh auto` → `claude --dangerously-skip-permissions … "$prompt"`, no TTY, stdout redirected to a log) the process exits the moment a turn ends. There is no session left to deliver a `run_in_background` completion notification to, so any backgrounded work dies with the process and the code that was supposed to run "when the poll returns" never runs at all. The orchestrator then treats the run as finished and cleans up.

Both halves of that have already cost a run:

- **Uncommitted work is destroyed.** HON-562's first run ended a turn with "E2E is still running — I'll pick up when it lands" and lost a fully green batch (2026-08-30).
- **A finished PR is stranded.** HON-570 (PR #650) and HON-571 (PR #651) ended their turns beside a Phase 6.1 CI poll. HON-570's worker exited 36 seconds later — before the poll's opening `sleep 30` had even elapsed. Both PRs sat open and unmerged until a human merged them by hand ~45 minutes later (HON-573).

So: never end a turn whose last message describes in-flight work in future tense ("CI is re-running — I'll merge once it settles" is exactly the sentence that stranded #651). The last message of a turn must be a phase marker, an explicit error stop, the **Phase 6.7 review-round-cap hand-off**, or the final completion marker.

That last one is a deliberate terminal state, not a failure. Phase 6 caps the review → fix → re-review loop at **3 rounds**; when the cap is reached the PR is handed to a human with its findings summarised, instead of looping until an external budget kills the worker (HON-630).

**Backgrounding a command is allowed; ending the turn beside it is not.** When a command outruns Bash's 600 s foreground cap, you may start it with `run_in_background: true` — but the same turn must then *wait on it* with foreground wait-chunks until it reaches a terminal marker (the pattern in Phase 3.3, 6.1 and 7.2). A tool call in flight cannot end a turn, and the 600 s cap is per call, not per turn, so chained foreground waits cover an arbitrarily long job. Committing and pushing each batch (Phase 3.3) is still required — it is what makes a process death survivable — but it is not a licence to end the turn early.

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

**Hard gate — run the three checks in this order (status → assignee → blockers) and stop at the first failure.** An explicit `HON-XX` argument skips Phase 1 entirely, so this is the only filter on that path. The order matters: a closed issue short-circuits before the assignee and blocker checks, so an issue that is itself `Duplicate` (e.g. HON-496) never reaches the blocker check and cannot be used to exercise it.

**The orchestrator pre-claims.** `scripts/orchestrator.sh` calls `claim_issue()` (state → `In Progress`, assignee left untouched) _before_ it spawns `wt auto HON-XX` → `/auto-implement HON-XX`. On that path the issue is already `In Progress` and unassigned by the time 2.1 runs — that is the normal case, not a conflict. The gate therefore rejects on closed states and on foreign assignees, never on `In Progress` alone.

**Every gate stop must first undo the pre-claim.** If the issue is `In Progress` **and** `assignee` is `null`, it got there via `claim_issue()` — which writes only the state, never an assignee — and stopping would strand it: `fetch_todo_issues` only queries Todo, the orchestrator records a 0-commit exit as SUCCESS and cleans up the worktree, and nothing ever moves the issue back. So before printing the stop message, restore Todo so the orchestrator / `/next-issue` can see it again:

```
mcp__linear-server__save_issue({ id: "HON-XX", state: "Todo" })
```

Never touch an assigned issue — `In Progress` + assignee me is an explicit claim (`/plan-issue` step 11, or a previous attempt's 2.2) that a stop must not erase, and anything assigned to someone else is theirs. Leave every other state (`Backlog`, `Todo`, `In Review`, closed states) exactly as found: the unassigned pre-claim is the only write this step reverses. If a gate stops on an issue that is `In Progress` and mine, say so in the stop message and leave it for the operator.

**Gate on `statusType`, not on the state's display name.** `get_issue` returns `statusType` ∈ { `backlog`, `unstarted`, `started`, `completed`, `canceled`, `duplicate`, `triage` }; state names are workspace-configurable and `Triage` has no "closed" name to match. Keep the human-readable `status` in the stop message.

1. **Status** — stop if `statusType` is `completed`, `canceled`, `duplicate`, or `triage` (a Triage issue is not refined yet — `/next-issue` and Phase 1.4 reject it too). `backlog` / `unstarted` (Backlog, Todo) pass outright. `started` covers both `In Progress` and `In Review`, so also read the state name. `In Progress` passes **only if** the assignee check below passes (unassigned = the orchestrator pre-claim; me = my own earlier claim). `In Review` always stops: a PR is already open, `claim_issue()` never writes that state so it is never a pre-claim, and this skill has no step that resumes an existing PR (a `RETRY` after Phase 5 would recreate the branch from `origin/main` and fail on push). Nothing to undo on either stop — neither case was pre-claimed by this cycle.

   ```
   [auto-implement] ✗ Error: HON-XX is In Review — a PR is already open. Resume is not supported; finish or close that PR by hand, then move the issue back to Todo.
   ```

   ```
   [auto-implement] ✗ Error: HON-XX is [status] — not open for an autonomous cycle to claim. Pick another issue, or reopen / triage it in Linear first.
   ```

2. **Assignee** — the issue's `assignee` is a user (display name / id), never the literal string `"me"`, so resolve the current user once and compare against that:

   ```
   mcp__linear-server__get_user({ query: "me" })
   ```

   Note the returned `id` and `name`. The issue passes if `assignee` is `null`, or its id (`assigneeId` / `assignee.id`, when returned) matches the resolved `id` — fall back to comparing the display name only if `get_issue` returns no id. Stop otherwise; do not reassign and do not change its state (it has an assignee, so it was not pre-claimed):

   ```
   [auto-implement] ✗ Error: HON-XX is assigned to [assignee name] — not mine to claim. Unassign it in Linear (or have them hand it over) before running /auto-implement.
   ```

3. **Blockers** — `relations.blockedBy` entries carry only `{ id, title }`; there is no status on them. Re-fetch each blocker, same pattern as Phase 1.4 and `/next-issue`. `includeRelations: true` is mandatory here as on every `get_issue` call (CLAUDE.md) — without it the response has no `relations` key at all, so `duplicateOf` is invisible and the successor hint below can never be given:

   ```
   for each blocker in relations.blockedBy:
     mcp__linear-server__get_issue({ id: blocker.id, includeRelations: true })
     → note its status / statusType (and relations.duplicateOf, if statusType is duplicate)
   ```

   An empty `blockedBy` passes. Every blocker must be `Done` or `Canceled` (`statusType` `completed` / `canceled`); otherwise undo the pre-claim (above), list the open ones and stop:

   ```
   [auto-implement] ✗ Error: HON-XX is blocked by open issues:
     - HON-YY ([status]) — [title]
   ```

   A blocker with `statusType` `duplicate` never clears on its own: follow its `duplicateOf` successor if set, otherwise re-point or remove the stale relation in Linear. Do not auto-clear it — `scripts/orchestrator.sh` applies the same Done/Canceled-only rule (and logs `[SKIP] HON-XX blocked by HON-YY (Duplicate)` each poll), so the unattended path agrees.

### 2.2 Claim issue

Immediately after the gate passes — before any planning work — set status to "In Progress" and assign to self. On the orchestrator's first attempt this fills in the assignee that `claim_issue()` left empty; on a direct `/auto-implement HON-XX` invocation it is the actual claim that keeps other agents off the issue. (`In Review` never reaches this step — see the status check.)

```
mcp__linear-server__save_issue({ id: "HON-XX", state: "In Progress", assignee: "me" })
```

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
6. If the 2.7 plan has a `## Coupled callsites` section, work it like the implementation steps — it is a sibling of `## Implementation Steps`, not a member, so nothing else will pick it up. Every **Mirror** must be edited in this phase; leaving them for the 4.3 review bullet reproduces the find-it-in-review failure this scan exists to prevent

### 3.3 Batched plans: commit and push per batch

When the plan splits the work into sequential batches (dependency refreshes, migration series, multi-step refactors), do NOT defer all commits to Phase 5:

- Commit each batch as soon as its fast gate passes (`pnpm lint && pnpm type-check && pnpm test`, plus `pnpm build` when the plan calls for it), following the Phase 5.1/5.2 staging and message conventions.
- Push after the first batch commit (`git push -u origin $(git branch --show-current)`) and after each subsequent one. Phase 5 then skips straight to PR creation (5.3) for what is already pushed.
- Long-running verification (`pnpm test:e2e:local`, large `pnpm test-storybook:ci` runs) executes AFTER the batch's commit is pushed. Such a run outlives Bash's 600 s foreground cap, so start it with `run_in_background: true` as one self-contained command that writes its terminal marker to a file, then **wait on that file in the same turn** with foreground wait-chunks — the Phase 6.1 pattern, applied to a marker file instead of `gh pr checks`:

  ```bash
  # Start (run_in_background: true) — the marker file is the only handoff.
  rm -f /tmp/batch-verify.done
  { pnpm test:e2e:local && echo E2E_PASS || echo E2E_FAIL; } > /tmp/batch-verify.log 2>&1
  tail -1 /tmp/batch-verify.log > /tmp/batch-verify.done
  ```

  ```bash
  # Wait (FOREGROUND, timeout: 540000) — re-issue while it prints VERIFY_WAITING.
  for i in $(seq 1 32); do
    if [ -s /tmp/batch-verify.done ]; then cat /tmp/batch-verify.done; exit 0; fi
    sleep 15
  done
  echo VERIFY_WAITING
  ```

  `E2E_PASS` → continue. `E2E_FAIL` → read `/tmp/batch-verify.log` and fix forward with a follow-up commit in the same batch — never rewrite a pushed batch commit. `VERIFY_WAITING` → re-issue the wait; do not end the turn on it. Do not start the next batch until the verification result is in.

**Why:** a batch commit gated on long verification is a batch that can be lost. The orchestrator deletes the worktree and local branch on every worker exit and gates clean 0-commit exits (HON-562, 2026-08-30: batch 1 was fully green but uncommitted while E2E was still seeding; the worker's turn ended, the process exited, and everything was discarded). Pushed commits are the only state that survives a worker death — and the foreground wait is what keeps the process alive long enough to act on the result (HON-573).

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

### Review-round budget — hard cap of 3 rounds

Phase 6 is the only loop in this skill: 6.3 reviews, 6.4 triages, 6.5 fixes, 6.6 pushes and comes back to 6.3 for the next round. It has to be bounded, because its natural exit — "the reviewer eventually runs out of findings" — only exists when there is an **oracle**: a failing test, a type error, a broken selector. On a prose or heuristic deliverable there is always another defensible finding, so the loop runs until something external kills the worker. HON-627 took **14 rounds over 2h45m** and ended `Stranded` with a green, mergeable PR (#707) that a human had to merge by hand — and its findings, each defensible on its own, grew the artifact until it was no longer usable. For contrast, the 12 PRs before it took 1 round (nine of them), 2 rounds (one), and 3 rounds (two): three rounds covers every PR that has ever converged here.

**ROUND is the number of `<!-- claude-review -->` comments on the PR once 6.3 has posted the current one** — the count 6.3 already fetches to verify the review landed. Deriving it from GitHub rather than from a local counter means it survives process death, context summarization, and a RETRY worker resuming the same PR, and it correctly counts rounds already spent by a manual `/review-pr`.

A counter that can stall is not a cap, so 6.3 requires `ROUND` to be **strictly greater** than the count taken before the run and stops the cycle if it is not. That is what makes each iteration consume budget and the loop provably terminate; the stale-lock path that can otherwise freeze it is described there.

Every round ends in exactly one of these, and only the second one re-enters 6.3:

| Outcome of the round                                                                                | Next                                                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Clean review — summary says "No issues found" **and** the anchored inline list is empty              | Phase 7, merge (6.4)                                              |
| Findings addressed and pushed, `ROUND` < 3                                                          | back to 6.3 for the next round (6.6 branch A)                     |
| Findings addressed and pushed, `ROUND` ≥ 3                                                          | **6.7 terminal hand-off** — do not merge, do not review again (6.6 branch B) |
| Nothing changed — every finding deferred as out of scope, or dropped by 6.4's bar                   | never re-review an identical diff: Phase 7 if `ROUND` < 3, else 6.7 (6.6 branch C) |

`./scripts/pr-review.sh` is therefore invoked at most 3 times in Phase 6. No other step in this skill invokes a reviewer, and 6.1's CI-fix loop is separately capped at 2 attempts, so there is no path through Phase 6 that runs a 4th round.

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
# (fast Vercel/smoke statuses register before the ci.yml job does); and, for a PR with
# non-docs files, the ci.yml job "Lint, Type Check & Test" is present. Each Bash call is a
# fresh shell, so PR_NUMBER is re-derived here and the previous poll's result is carried
# across chunks in a file — never reuse a shell variable.
PR_NUMBER=$(gh pr view --json number --jq .number)
FILES=$(gh pr view "$PR_NUMBER" --json files --jq '.files[].path')
NON_DOCS=$(printf '%s\n' "$FILES" | grep -Ev '\.md$|^docs/|^\.github/ISSUE_TEMPLATE/')
# ci.yml is paths-ignored for docs, and Preview smoke only fires on a SUCCESSFUL
# Vercel deploy — so a docs-only PR whose Vercel status is stuck has no other
# check at all, and exempting that one row leaves the list legitimately empty.
# Requires a non-empty FILES: a `gh pr view` that failed must never read as
# "docs-only, nothing to wait for" and settle a code PR on zero checks.
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
  [ -z "$NON_DOCS" ] || printf '%s\n' "$CUR" | grep -q '^Lint, Type Check' || OK=0   # ci.yml job registered (code PRs)
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
    - Wait: re-run the foreground wait-chunk + verification above, re-issuing on `CI_WAITING`

If still failing after 2 attempts:
    [auto-implement] ✗ Error: CI checks failing after fix attempts
    Stop here with failure details
```

### 6.2 Get PR info

```bash
gh pr view --json number,title,headRefName,url
```

### 6.3 Trigger Claude review

Spawn a fresh Claude Code session to review the PR. **You MUST use the script below — do NOT inline the review prompt or spawn claude directly.** The script handles model selection (the model set by `CLAUDE_REVIEW_MODEL`, default in `scripts/pr-review.sh`), locking, and prompt formatting.

**First record the marker count as `ROUND_BEFORE`**, using the same fetch as the verification below. The cap counts rounds by these markers, so the count has to be shown to *increase* — see the check after the run.

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-review.sh ${PR_NUMBER}
```

This runs synchronously. When it returns, the review has been posted to GitHub. It spawns `claude -p` and takes several minutes — run it in the **foreground** with `timeout: 600000`; the default 120 s Bash timeout kills it mid-run and leaves a stale `/tmp/claude-review-N.lock`. If it ever outruns 600 s, background it and wait on the `<!-- claude-review -->` comment with foreground wait-chunks in the same turn (Phase 3.3 pattern) — never end the turn beside it.

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

**`ROUND` must be greater than `ROUND_BEFORE`. If it is not, stop — never loop.** The cap rests entirely on the invariant that each `pr-review.sh` run adds exactly one marker, and that invariant *can* break: when a stale `/tmp/claude-review-${PR_NUMBER}.lock` is present (left by a killed run — see the timeout warning above), the script finds the previous round's marker, prints "Review already posted by another instance" and **exits 0 without reviewing**. The count then never moves, 6.4's "no summary at all" guard cannot fire because the previous round's summary is still on the PR, and 6.6 branch A re-enters 6.3 forever — reinstating the unbounded loop this cap exists to close. Requiring a strict increase is what makes each iteration consume budget, and therefore makes the loop provably terminate.

```
[auto-implement] ✗ Error: Review round did not post a new review (marker count stayed at ${ROUND_BEFORE}).
Likely a stale /tmp/claude-review-${PR_NUMBER}.lock from a killed run. Remove it and re-run, or review by hand.
```

Stop here (do not proceed to 6.4 and do not loop).

If the review was posted (count > 0):
```
[auto-implement] ✓ Claude review received (round ${ROUND}/3)
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

**Known limitation — this does not catch every stale comment.** A finding from an earlier round that was *addressed* but whose anchor merely shifted keeps `line != null`, and GitHub re-points its `commit_id` to the new head, so it is indistinguishable from a live finding. Filtering on `commit_id == head` does **not** help — verified on PR #667, where comment `3895696376` was addressed by `3a8f1f0` yet still reports `commit_id == head`, `line 417`. `isResolved` / `isOutdated` are both false on it too. Treat a re-reviewed PR's inline list as possibly containing settled findings, and check each against the diff before "fixing" it. Tracked in HON-585.

Also fetch the summary comment — **the most recent one only**, since each review round appends its own:

```bash
# --paginate + `jq -s 'add'`: without it the API returns only the first page (30 by default), and --jq cannot be used because gh applies it per page (HON-586).
gh api --paginate '/repos/:owner/:repo/issues/{number}/comments?per_page=100' \
  | jq -rs 'add | [.[] | select(.body | startswith("<!-- claude-review -->"))] | last | .body'
```

Dropping `| last` concatenates every round, so the "No issues found" check below would be judged against a mixture of verdicts from different commits.

This is also why the fetch cannot be written as `--paginate --jq '… | last'`: gh runs `--jq` once per page, so `last` would yield the newest marker *on each page* rather than the newest overall — reinstating the same defect through a different door. The `jq -s 'add'` form evaluates `last` against the whole set (HON-586).

**Triage rules:**

The reviewer only posts substantive issues (no nitpicks), so triage is simpler:

- **If the fetch returns no summary at all** → the review did not complete. Do not read this as clean; stop and report, matching 6.3's warning. An absent summary and a clean summary are not the same thing.
- If the latest summary contains "No issues found" **and** the anchored inline list is empty → clean review, skip to Phase 7
- Every anchored inline review comment → **Address Now** (they are all substantive by design)
- **Always read the latest summary body for findings too**, not only when the inline list is empty. `scripts/pr-review.sh` puts out-of-diff findings and anything past its 5-comment inline cap in the summary alone, so summary-only findings routinely arrive *alongside* inline ones. They are Address Now items as well.
- Never merge on an empty inline list alone.
- Use effort-first thinking for prioritization:
  - Quick fix → address now
  - Moderate fix → address now
  - Significant work → defer if genuinely out of scope

**Materiality bar — applies from ROUND 3 on.** On rounds 1 and 2 every substantive finding is an Address Now item, per the rules above. From round 3 the bar rises, because by then the cheap defects are gone and what is left is usually accretion:

- **Action it** only if it is a **correctness or safety defect** — wrong behaviour, a broken reference (a path, line number, step number, or command that does not resolve), a factual error in the text, a security or data-loss risk.
- **Do not action it** if the fix only adds coverage, edge cases, hedging, or qualification to something that already works as written. "This grep would also miss X", "this does not cover the case where Y", "consider noting Z" are coverage-only by definition.

The bar exists because the reviewer is asked "what is wrong with this?" and never "is this now worse than it was three rounds ago?" — an asymmetry that makes the loop self-sustaining. Each HON-627 finding was individually defensible; together they improved grep recall and destroyed the artifact's usability, which was the entire point of the artifact. A finding that makes a document longer and harder to follow is a finding worth dropping.

**What the bar decides, given the cap.** Round 3 routes to 6.7 either way, so the bar never changes *where* the run goes — it decides *what gets written into the artifact* on the way out. That is the thing HON-627 actually lost: not the routing, but three rounds of accretion appended after the document had stopped improving. Dropping a coverage-only finding here means the human at 6.7 inherits the artifact at its most usable, plus a `not actioned:` note explaining the call, rather than a longer document and no record of why it grew.

Record the call rather than silently skipping it — see 6.5's `not actioned:` convention.

### 6.5 Address review comments

For each item in "Address Now":

- For an inline comment: extract file path and line number — 6.4's `select(.line != null)` guarantees both are present
- For a summary-only finding: there are no coordinates, so locate the site yourself from the finding's description before editing
- Read the file at that location
- Apply the suggested fix using Edit tool

**The `not actioned:` convention — required for every finding the 6.4 materiality bar drops.** A skipped finding must read as a decision, not an oversight, or the next reviewer (or the human picking up a 6.7 hand-off) re-raises it and the loop restarts by hand.

For a finding that came in as an **inline comment**, reply on that comment so the note sits next to the code it declines to change:

```bash
# Substitute the literal PR number and the inline comment's `id` from 6.4's fetch.
gh api "/repos/:owner/:repo/pulls/<PR_NUMBER>/comments/<COMMENT_ID>/replies" \
  --method POST \
  -f body="not actioned: coverage-only, round >= 3 — <one line on what the finding asked for and why it is coverage rather than correctness>"
```

For a **summary-only finding** there is no comment to reply to; collect it and list it in the 6.7 hand-off comment instead.

Keep the `not actioned: coverage-only, round >= 3` prefix literal — it is what makes the decisions greppable across PRs when judging whether the bar is set right.

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

Wait for CI again — re-run the 6.1 foreground wait-chunk + verification, re-issuing on `CI_WAITING` until a terminal marker. Do not end the turn here.

Then take exactly one of these three branches. `ROUND` is from 6.3; "fixes were pushed" means 6.5 changed something and the commit above exists.

**A. Fixes were pushed and `ROUND` < 3** → go back to **6.3** and run the next review round against the new head.

```
[auto-implement] ✓ Round ${ROUND}/3 addressed and pushed → re-reviewing
```

**B. Fixes were pushed and `ROUND` ≥ 3** → the cap is reached. Do **not** run another review and do **not** proceed to Phase 7. Go to **6.7**.

**C. No fixes were made** — every finding was deferred as genuinely out of scope, or dropped by the materiality bar. Nothing changed, so a re-review would return the identical findings against the identical diff; never loop back to 6.3 on this branch, at any round. Instead:

- `ROUND` < 3 → proceed to Phase 7 and merge, as before. The findings were a deliberate defer, and the diff the reviewer approved is the diff being merged.
- `ROUND` ≥ 3 → go to **6.7**. At the cap, findings left unaddressed are handed to a human rather than merged past.

Print the block below only when Phase 6 actually hands off to Phase 7 — that is branch C under the cap here, or the clean-review exit in 6.4. Branch A goes back to 6.3; branch B and branch C at the cap go to 6.7, and both print their own markers instead:

```
[auto-implement] ✓ Reviews addressed (round ${ROUND}/3)
[review-pr:complete]
[auto-implement] Phase 6/7 complete → Proceeding to Phase 7
```

### 6.7 Review-round cap reached — terminal hand-off

Reached only from 6.6 branch B or C — `ROUND` ≥ 3 with findings still on the table. It is a **designed exit, not a crash**: the work is committed, CI is green, and the PR is left open for a human to judge. Getting here in ~25 minutes instead of 2h45m is the entire point, and the `Stranded` label and its recovery path already exist and need no change.

**It is not free, though, and must not become routine.** `scripts/orchestrator.sh` `strand_worker` treats an unmerged run as a failure to ship: it logs `[OUTCOME] … STRANDED`, calls `note_consecutive_failure` (three in a row trips the circuit breaker at `MAX_CONSECUTIVE_FAILURES=3`), sets `ONCE_EXIT_CODE=1`, and deliberately skips `cleanup_worker_worktree` — so every hand-off leaves a worktree, a local branch and a Neon branch that only `wt cleanup <branch>` reclaims. A cap hand-off should stay the exception it was before (one run in the last 13). If runs start landing here regularly, the answer is to look at why the reviewer keeps finding things, not to raise the cap.

Post a hand-off comment on the PR listing what happened, so the human inherits the decisions rather than re-deriving them:

```bash
# Substitute the literal PR number.
gh api /repos/:owner/:repo/issues/<PR_NUMBER>/comments \
  --method POST \
  -f body="## Review-round cap reached (3/3)

\`/auto-implement\` stops looping after 3 review rounds (HON-630). CI is green and the branch is pushed; this PR is ready for a human decision.

**Addressed across rounds 1-3:**
- [one line per finding that was fixed, with the commit that fixed it]

**Not actioned (materiality bar, round >= 3):**
- [one line per coverage-only finding, with why — mirrors the \`not actioned:\` replies on the inline comments]

**Still open:**
- [any finding that is correctness/safety but was too large to fix in scope, or 'none']

To finish: review the above, then merge, or push a fix and merge. If this run was orchestrated it also carries the \`Stranded\` label and a preserved worktree — release it with \`wt cleanup <branch>\` and clear the label once the PR is settled, or nothing reclaims either."
```

Post the same summary as a Linear comment on the issue, then stop:

```
mcp__linear-server__save_comment({ issueId: "HON-XX", body: "[the same hand-off summary]" })
```

**Do not change the issue's Linear state.** Linear moved it to `In Review` when the PR opened, which is accurate — a PR is open and unmerged — and `strand_worker` deliberately leaves that state alone when a PR exists (`scripts/orchestrator.sh`, the comment above its `restore_todo_if_in_progress` call). The `Stranded` label is what flags the issue for pickup, and the orchestrator adds it on a clean worker exit as well as a timeout, so reaching 6.7 and stopping is enough to get it.

```
[auto-implement] ⚠ Review-round cap reached (3/3) — handing off
[auto-implement] PR left open with a hand-off comment; not merged
[auto-implement] ✗ Autonomous implementation cycle stopped at Phase 6 (review-round cap)
```

Stop here. Do not proceed to Phase 7. This message ends the turn — it is a terminal marker, so the Execution Model rule against ending a turn on in-flight work is satisfied.

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

Same mechanism as 6.1 — foreground wait-chunks, then foreground verification. Never background this poll and never end the turn beside it; re-issue on `CI_WAITING` until a terminal marker.

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
# (fast Vercel/smoke statuses register before the ci.yml job does); and, for a PR with
# non-docs files, the ci.yml job "Lint, Type Check & Test" is present. Each Bash call is a
# fresh shell, so PR_NUMBER is re-derived here and the previous poll's result is carried
# across chunks in a file — never reuse a shell variable.
PR_NUMBER=$(gh pr view --json number --jq .number)
FILES=$(gh pr view "$PR_NUMBER" --json files --jq '.files[].path')
NON_DOCS=$(printf '%s\n' "$FILES" | grep -Ev '\.md$|^docs/|^\.github/ISSUE_TEMPLATE/')
# ci.yml is paths-ignored for docs, and Preview smoke only fires on a SUCCESSFUL
# Vercel deploy — so a docs-only PR whose Vercel status is stuck has no other
# check at all, and exempting that one row leaves the list legitimately empty.
# Requires a non-empty FILES: a `gh pr view` that failed must never read as
# "docs-only, nothing to wait for" and settle a code PR on zero checks.
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
  [ -z "$NON_DOCS" ] || printf '%s\n' "$CUR" | grep -q '^Lint, Type Check' || OK=0   # ci.yml job registered (code PRs)
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

**CRITICAL: On `CI_SETTLED`, verify ALL checks passed — including a Vercel deployment that reported.** With `--json`, `gh pr checks` exits 0 even when checks failed or were cancelled, so inspect `bucket`: anything other than `pass`/`skipping` (`fail` or `cancel` — FAILURE, CANCELLED, TIMED_OUT, ERROR) is a failure. The one exemption matches the poll's: a still-`pending` third-party commit status (empty `workflow`) does not block, because it can stick forever after the deploy is Ready:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
# A third-party commit status (empty workflow — Vercel) is exempt while pending:
# it can stick after the deploy is Ready (HON-600). A fail still blocks: CI runs
# no `next build`, so Vercel is the only build gate.
gh pr checks "$PR_NUMBER" --json name,bucket,state,workflow \
  --jq '.[] | select(.workflow != "" or .bucket != "pending") | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.state)"'
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

**Do NOT merge if any check is in the `fail` or `cancel` bucket, including Vercel deployment checks.** This is a hard gate — no exceptions. `ci.yml` runs no `next build`, so a failed Vercel deploy is the only build gate there is; only a *pending* one is exempt.

**Known residual risk of that exemption (accepted in HON-600).** `gh pr checks` carries no signal separating "stuck after Ready" from "still deploying", so a Vercel build that is merely *queued* past the ~13 min `Lint, Type Check & Test` job is dropped along with a stuck one, and the merge lands before it reports. The exemption is still the right trade — Vercel builds here take 38 s–1 min, and the alternative stranded three finished PRs in one night — but the durable fix is HON-584 (required status checks on `main`), which makes GitHub itself refuse the merge. Same caveat applies to the `smoke` label: `preview-smoke.yml` is `on: deployment_status` gated on `state == 'success'`, so its checks never register while Vercel is pending and a labelled PR can merge without them. Requiring them instead would re-strand exactly the PRs this fixes, and `staging-smoke` still runs post-merge.

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
| 6     | Review-round cap reached (3)    | 6.7 hand-off — terminal, not an error: PR left open with a summary comment, not merged |
| 7     | Merge fails                     | Stop, show error       |
