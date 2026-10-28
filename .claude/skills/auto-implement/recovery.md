# Auto-implement — recovery paths

Read a section when `SKILL.md` points to it. Each one names where the cycle goes next.

## Retry context

When `scripts/orchestrator.sh` triages a failed worker as `RETRY`, hits the Neon-cap one-retry, or gives a stranded run its one finish attempt (HON-1065), it respawns `wt auto` with a note appended to this prompt: the phase and failure type the previous attempt died in, its duration and commit count, and the last 40 lines of its log (redacted by `sanitize_log`; progress markers rewritten from `[x:complete]` to `(x:complete)` so they are not read as this run's progress). It is present only on a retry (HON-728). A respawn after a network drop (HON-1414) has a shorter note: the phase, the commit count, the PR if one is open, and the path of a patch that holds the previous attempt's uncommitted work, if it had any.

**If it is present, read it before anything else** and treat it as the first finding of this run: the previous attempt already paid for that failure once. `wt auto` has checked out the kept branch as-is, so pushed work is on disk. Establish where the previous attempt got to, in this order:

```bash
git log --oneline origin/main..HEAD                       # commits it already made
gh pr list --head "$(git branch --show-current)" --state open --json number,url
```

- **A patch is named** → apply it first with `git apply <path>`, before the checks below. The previous attempt never committed that work.
- **Open PR for this branch** → run Phase 0, then 2.1 (the `In Review` exception there applies), skip 2.2–5, and resume at **6.1**, the start of Phase 6: review first, then the 6.5 CI wait. `ROUND` counts the PR's existing `<!-- claude-review -->` markers, so earlier rounds still count toward the cap.
- **Commits, no PR** → run Phases 0–2.1 as normal, then look for the plan comment the previous attempt posted in 2.8 (`list_comments`). If there is one, reuse it instead of re-planning and do not post a second; continue Phase 3 from the first step the commits do not cover.
- **No commits** → run the full cycle.

On every path, fix the failure the note describes before redoing work that already landed. A retry has four sources: a failure triage judged transient, the Neon cap, the one finish attempt after a strand (HON-1065), and the respawn after a network drop (HON-1414). The last two get no triage at all. So a note describing an infrastructure fault is not by itself a reason to stop — the fault may have cleared. Stop with an error naming it only if the same fault recurs in this run.

## Gate stops (2.1)

The full 2.1 gate, with the stop messages. Read it whenever a check in `SKILL.md` → 2.1 fails.

**Hard gate — run the three checks in this order (status → assignee → blockers) and stop at the first failure.** An explicit `HON-XX` argument skips Phase 1 entirely, so this is the only filter on that path. The order matters: a closed issue short-circuits before the assignee and blocker checks, so an issue that is itself `Duplicate` (e.g. HON-496) never reaches the blocker check and cannot be used to exercise it.

**The orchestrator pre-claims.** `scripts/orchestrator.sh` calls `claim_issue()` (state → `In Progress`, assignee left untouched) _before_ it spawns `wt auto HON-XX` → `/auto-implement HON-XX`. On that path the issue is already `In Progress` and unassigned by the time 2.1 runs — that is the normal case, not a conflict. The gate therefore rejects on closed states and on foreign assignees, never on `In Progress` alone.

**Every gate stop must first undo the pre-claim.** If the issue is `In Progress` **and** `assignee` is `null`, it got there via `claim_issue()` — which writes only the state, never an assignee — and stopping would strand it: `fetch_queued_issues` only queries Queued, the orchestrator records a 0-commit exit as SUCCESS and cleans up the worktree, and nothing ever moves the issue back. So before printing the stop message, restore Queued — where `claim_issue()` took it from — so the orchestrator / `/next-issue` can see it again:

```
mcp__linear-server__save_issue({ id: "HON-XX", state: "Queued" })
```

Never touch an assigned issue — `In Progress` + assignee me is an explicit claim (`/plan-issue` step 11, or a previous attempt's 2.2) that a stop must not erase, and anything assigned to someone else is theirs. Leave every other state (`Backlog`, `Todo`, `Queued`, `In Review`, closed states) exactly as found: the unassigned pre-claim is the only write this step reverses. If a gate stops on an issue that is `In Progress` and mine, say so in the stop message and leave it for the operator.

**Gate on `statusType`, not on the state's display name.** `get_issue` returns `statusType` ∈ { `backlog`, `unstarted`, `started`, `completed`, `canceled`, `duplicate`, `triage` }; state names are workspace-configurable and `Triage` has no "closed" name to match. Keep the human-readable `status` in the stop message.

1. **Status** — stop if `statusType` is `completed`, `canceled`, `duplicate`, or `triage` (a Triage issue is not refined yet — `/next-issue` and Phase 1.4 reject it too). `backlog` / `unstarted` (Backlog, Todo, Queued) pass outright — an explicit `HON-XX` is a human's call, whatever the state. `started` covers both `In Progress` and `In Review`, so also read the state name. `In Progress` passes **only if** the assignee check below passes (unassigned = the orchestrator pre-claim; me = my own earlier claim). `In Review` stops, with one exception: a PR is already open, `claim_issue()` never writes that state so it is never a pre-claim, and a fresh run has no way to resume a PR it did not open. **The exception is an orchestrator retry** — retry context is present, and `gh pr list --head "$(git branch --show-current)" --state open` finds the open PR on this branch. `wt auto` checked the kept branch out as-is, so that PR is this cycle's own work: pass the gate (assignee check still applies), skip 2.2 so the state is left `In Review`, and resume at 6.1 per Retry context above. Nothing to undo on either stop — neither case was pre-claimed by this cycle.

   ```
   [auto-implement] ✗ Error: HON-XX is In Review — a PR is already open. Resume is not supported; finish or close that PR by hand, then move the issue back to Queued (or Todo, if a human will take it).
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

## No checks reported (6.5, 7.2)

- `no checks reported on the '<branch>' branch` on stderr (exit 1) → stop, do not merge. `ci.yml` runs on every PR, docs-only ones included, and `Lint, Type Check & Test` is a required check (HON-584), so no PR is exempt: an empty check list means CI did not report, and GitHub would refuse the merge anyway. In practice the 6.5 poll does not settle without that job's row, so this branch is defensive. Report it and stop; do not enter the CI-fix loop, because there is no failure to fix.

## CI-fix loop (6.5, 6.6)

A CI failure is fixed in the round's one 6.5 fix pass, beside the Address Now items. **At most 2 CI-fix attempts per run, across all rounds**: each push that fixes a CI failure is one attempt.

- **`ROUND` < 3** → fix it in 6.5. 6.6 commits and pushes, and rule A sends the push to one more review, because 7.2 must not merge a commit that no review saw. That round's 6.5 waits on CI again. A clean review with red CI takes this path too.
- **`ROUND` ≥ 3** → fix it in 6.5. 6.6 pushes and waits on CI with no 4th review, as rule C allows. If CI fails again, loop here:

```
while CI failing and ci_attempts < 2:
    ci_attempts += 1
    [auto-implement] CI fix attempt {ci_attempts}/2

    - Analyze CI failure output
    - Apply fixes using Edit tool
    - Stage specific changed files by name and commit:
      git add [changed files] && git commit -m "fix: Address CI failures"
    - Push: git push
    - Wait: re-run the SKILL.md 6.5 foreground wait-chunk + verification, re-issuing on `CI_WAITING`
```

CI still failing after 2 attempts, on either path:

```
[auto-implement] ✗ Error: CI checks failing after fix attempts
```

Stop here with the failure details.

## Stale review lock (6.3)

**`ROUND` must be greater than `ROUND_BEFORE`. If it is not, stop — never loop.** The cap rests entirely on the invariant that each `pr-review.sh` run adds exactly one marker, and that invariant *can* break: when a stale `/tmp/claude-review-${PR_NUMBER}.lock` is present (left by a killed run — see the timeout warning in `SKILL.md` 6.3), the script finds the previous round's marker, prints "Review already posted by another instance" and **exits 0 without reviewing**. The count then never moves, 6.4's "no summary at all" guard cannot fire because the previous round's summary is still on the PR, and 6.6 branch A re-enters 6.2 forever — reinstating the unbounded loop this cap exists to close. Requiring a strict increase is what makes each iteration consume budget, and therefore makes the loop provably terminate.

```
[auto-implement] ✗ Error: Review round did not post a new review (marker count stayed at ${ROUND_BEFORE}).
Likely a stale /tmp/claude-review-${PR_NUMBER}.lock from a killed run. Remove it and re-run, or review by hand.
```

Stop here (do not proceed to 6.4 and do not loop).

**Strict increase is the whole test — `ROUND > ROUND_BEFORE`, not `ROUND > 0`.** A count-based check passes on the stale-lock path (`ROUND_BEFORE` = 2, `ROUND` = 2: no new review, but the count is still non-zero), which is precisely the case that must stop. There is one decision here, and it is the comparison:

- `ROUND > ROUND_BEFORE` → a new review landed. Continue to 6.4.
- `ROUND == ROUND_BEFORE` → no new review, at any count including 0. Stop with the error above. Never "proceed anyway": with a previous round's summary still on the PR, 6.4 would read stale findings as current and 6.6 would loop on them.
