# Auto-implement — the incidents behind the rules

Read before changing or disputing a rule in `SKILL.md` or its sibling files. Nothing here is needed to run a cycle.

Each section is keyed by the phase or step it explains. HON-1230 moved every incident reference and "why this is here" paragraph out of `SKILL.md` into this file, so the procedure carries the action, the command and the check, and this file carries the reason.

## Terminal turns (Execution Model; HON-562, HON-573)

A headless worker exits the moment its turn ends, so ending a turn beside in-flight work loses either the work or the merge. Both halves of that have already cost a run:

- **Uncommitted work is destroyed.** HON-562's first run ended a turn with "E2E is still running — I'll pick up when it lands" and lost a fully green batch (2026-08-30).
- **A finished PR is stranded.** HON-570 (PR #650) and HON-571 (PR #651) ended their turns beside a Phase 6.1 CI poll. HON-570's worker exited 36 seconds later — before the poll's opening `sleep 30` had even elapsed. Both PRs sat open and unmerged until a human merged them by hand ~45 minutes later (HON-573).

The mechanism: the orchestrator's headless spawn (`worktree-claude.sh auto` → `claude --dangerously-skip-permissions … "$prompt"`, no TTY, stdout redirected to a log) exits the moment a turn ends. No session is left to receive a `run_in_background` completion notification, so backgrounded work dies with the process, the code meant to run "when the poll returns" never runs, and the orchestrator treats the run as finished and cleans up. "CI is re-running — I'll merge once it settles" is the sentence that stranded PR #651.

**Backgrounding a command is allowed; ending the turn beside it is not.** A tool call in flight cannot end a turn, and Bash's 600 s cap is per call, not per turn, so chained foreground wait-chunks cover a job of any length. That is the pattern in 6.1 and `batched.md`. The canonical rule is CLAUDE.md → Working style → "Waiting inside a skill with a defined endpoint"; `SKILL.md` points to it once, at 6.1, the first step where a worker would background something.

**Bash is not the only tool that backgrounds work (HON-1119).** A subagent starts in the background by default, Monitor delivers its result as a later notification, and an MCP call that runs past 2 minutes moves to the background on its own. Each fails the same way in a headless run. So an Agent is spawned with `run_in_background: false`, Monitor is not used, and the worker launch sets `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` (`scripts/worktree-claude.sh`) so a slow Linear or Playwright call stays in the foreground.

**The 6.7 hand-off is a terminal state, not a failure (HON-630).** Phase 6 caps the review → fix → re-review loop at 3 rounds. When the cap is reached with a correctness finding unresolved, the PR goes to a human instead of looping until an external budget kills the worker.

## Arguments and retry context (HON-728)

On an orchestrator retry the arguments continue past the issue ID with a block that starts `Retry context:`. The issue ID is the first token only, so the block is never read as part of it. `recovery.md` → Retry context says where to resume.

## Regular repo mode (0.1; HON-1230)

Every orchestrator worker runs in a worktree, so the regular-repo variants of 0.2, 0.4, 3.1, 7.3, 7.5 and 7.6 moved to `regular-repo.md`, read only when 0.1 finds no worktree.

## Sync with origin/main (0.4)

**Why this matters:** Branching from a stale local main means every subsequent tool (Explore, planning, codebase grep) searches an outdated tree. If a related or epic-sibling issue landed on origin/main since you last pulled, its files, migrations, conventions, and constants won't be visible. At PR time you'll hit merge conflicts and schema collisions on code you didn't know existed — exactly the HON-500 ↔ HON-501 migration collision that motivated this step.

## Discovery reads Queued only (Phase 1; HON-854)

Auto-discovery reads the `Queued` state only, the same queue the orchestrator reads. Todo and Backlog are never picked up unattended, because Todo means a human will do the work.

## The 2.1 gate and the 2.2 claim

An explicit issue ID skips Phase 1, so 2.1 is the only filter on that path. The orchestrator pre-claims: `claim_issue()` in `scripts/orchestrator.sh` sets the state to `In Progress` and leaves the assignee empty before it spawns the worker, so `In Progress` + unassigned is the normal case, not a conflict. On the orchestrator's first attempt 2.2 fills in that assignee; on a direct run it is the claim that keeps other agents off the issue. `relations.blockedBy` entries carry no status, which is why each blocker is re-fetched.

## Sibling overlap check (2.3)

**Why:** When an issue is part of an epic (has `parentId`) or has `relatedTo` links, a sibling issue may have already landed and introduced files, conventions, schema, or constants that your plan needs to build on rather than duplicate. `blockedBy` is checked by Phase 1's selection filter, but `relatedTo` / epic-siblings are not — and a Done sibling in the same epic is a strong "check for overlap" signal. The HON-500 ↔ HON-501 incident (duplicate `Household.locale` schema change, duplicate `locales.ts`) is what motivated this step.

The merged PR is looked up by the sibling's `gitBranchName` because PR titles are Conventional Commits and carry no issue ID, so a title search finds nothing. The body search is the fallback for a renamed branch.

2.6 then reads the sibling's actual diff (`git log` / `git diff` on the overlapping paths) because an Explore agent sees only static file content and cannot tell which lines are new. Reading the diff prevents "I searched and it didn't exist" → "it existed and I duplicated it".

## Coupled callsites (2.6, 3.2, 4.3; HON-612)

`/auto-implement` inlines its own planning phase, so `/plan-issue` step 7b does not otherwise fire; 2.6 runs the scan. HON-612 changed a primitive's geometry and desynced 12 route `loading.tsx` skeletons; review, not planning, caught it. `## Coupled callsites` is a sibling of `## Implementation Steps`, not a member, so 3.2 lists it as its own step: leaving the Mirrors for the 4.3 review bullet reproduces the find-it-in-review failure. A clean scan writes an explicit `none — …` line, because without it a clean scan looks like one that never ran.

## Follow-ups get an ID before the plan posts (2.8; HON-1053)

A plan that said "filed as a follow-up" with no ID was the HON-1053 defect: nobody filed it. 2.8 files each `to file:` line first and posts the plan only once every line has an ID. The plan has to be on Linear before Phase 3 because a retry and the later phases read it from there. Phase 3 follow-ups are filed at once in 3.2, not through the deferrals file, because 4.4 truncates that file after Phase 3.

## Diff reading in 4.2 (HON-1230)

4.2 used to read three full diffs (`git diff origin/main...HEAD`, `--cached`, unstaged). It now reads `--stat` for each and `git diff -- <file>` only for the files the self-review must judge, because `scripts/pr-review.sh` reads the full diff in 6.3 and the worker does not need it twice.

## Deferrals file is truncated at 4.4

`scripts/orchestrator.sh` retries a failed worker once on the same issue, `/tmp` outlives the worktree teardown, and 2.1 passes that retry through. An append-only file would double every block on the second attempt and spend the 3-issue cap on copies that 6.8's Linear duplicate check cannot catch, because they are not filed yet. The file is the single sink for every deferral in the run: Phase 5, the CI waits and up to three review rounds sit between 4.4 and 6.8, so in-context state does not carry deferrals across that span.

## No checkboxes in a PR body (5.4; HON-860)

This cycle merges with every `- [ ]` still open, so a box addressed to a human is addressed to nobody. The "Verified" / "Not verified" lists replaced the test plan: a line is verified only if it was run, and an uncheckable fact is stated as risk.

## Triage rubric (4.4, 6.4; HON-1230)

The effort-first rubric was written out in `branch-review/SKILL.md`, `triage-pr-comments/SKILL.md`, `auto-implement/SKILL.md` and `auto-implement/deferral.md`, and four copies drift. It now lives once in `docs/TRIAGE_RUBRIC.md`, outside `.claude/skills/` because three skills read it and a skill directory without a `SKILL.md` is not a skill.


## The review-round cap (Phase 6; HON-627, HON-630)

Phase 6 is the only loop in this skill: 6.3 reviews, 6.4 triages, 6.5 fixes, 6.6 pushes and comes back to 6.3 for the next round. It has to be bounded, because its natural exit — "the reviewer eventually runs out of findings" — only exists when there is an **oracle**: a failing test, a type error, a broken selector. On a prose or heuristic deliverable there is always another defensible finding, so the loop runs until something external kills the worker. HON-627 took **14 rounds over 2h45m** and ended `Stranded` with a green, mergeable PR (#707) that a human had to merge by hand — and its findings, each defensible on its own, grew the artifact until it was no longer usable. For contrast, the 12 PRs before it took 1 round (nine of them), 2 rounds (one), and 3 rounds (two): three rounds covers every PR that has ever converged here.

**ROUND is the number of `<!-- claude-review -->` comments on the PR once 6.3 has posted the current one** — the count 6.3 already fetches to verify the review landed. Deriving it from GitHub rather than from a local counter means it survives process death and context summarization within a run, and that it counts rounds this run did not perform: a manual `/review-pr`, or an earlier worker on the same branch. (It is not a resume mechanism in its own right — Phase 2.1 stops on `In Review`, so an open PR re-enters Phase 6 only through an orchestrator retry, which resumes at 6.1 per `recovery.md` → Retry context. Its earlier rounds are on the PR and still count.)

A counter that can stall is not a cap, so 6.3 requires `ROUND` to be **strictly greater** than the count taken before the run and stops the cycle if it is not. That is what makes each iteration consume budget and the loop provably terminate; the stale-lock path that can otherwise freeze it is described there.

**The cap bounds reviews, not merges.** Round 3's findings can still be fixed and shipped — what the cap forbids is asking for a *fourth opinion* on the result. That distinction is load-bearing: the two 3-round PRs in the recent history (#704, #700) each merged by fixing round 3's findings and merging without re-reviewing, so a cap that also blocked the merge would strand runs that converged perfectly well.

The 6.6 branch C merge path: Round 3's fix ships without a 4th review, which is exactly how the two 3-round PRs in the recent history converged (#704: review `08:03:05Z` → fix `08:10:50Z` → merged `08:20:04Z`; #700: `22:23:34Z` → `22:28:03Z` → `22:37:06Z`). Stranding these would triple the hand-off rate for no gain and walk the orchestrator toward `MAX_CONSECUTIVE_FAILURES`.

**The `ROUND_BEFORE` gate in 6.3.** A PR can arrive with three markers already, from a manual `/review-pr` or an earlier worker on the same branch. Running the reviewer anyway spends a 4th `claude -p` round before 6.6 can notice, so 6.3 skips the reviewer when `ROUND_BEFORE` ≥ 3 and triages the findings already on the PR. `ROUND == ROUND_BEFORE` at any count, including a non-zero one, means no new review landed, usually a stale `/tmp/claude-review-${PR_NUMBER}.lock` that made the script exit 0 without reviewing. Proceeding would triage the previous round's findings as current and loop on them.

**Why 6.6 always runs.** Only its commit is conditional. Skipping the step on "no fixes were made" skipped the merge-versus-hand-off decision with it.

**Branch B never re-reviews.** When every finding was deferred, a re-review returns the identical findings against the identical diff. A round whose only fix was a PR-body edit lands there too.

**Correctness routes to 6.7 at any round.** The triage rubric's "significant work → defer if out of scope" covers scope, not defects. If the rule depended on the round, handing a defect to a human at round 3 while merging the identical one at round 1 would make "defer everything immediately" the cheapest and least supervised way out of Phase 6.

**6.1's chunk budget.** `scripts/ci-settle.sh` increments its chunk counter before polling, so a call killed at its timeout still shrinks the budget and a repeat lands on `CI_TIMEOUT` instead of looping. The exception is a `Usage:` line on stderr (exit 2): `gh pr view` returned no PR number, no chunk was counted, and a re-issue would loop. Six chunks (about 48 min) cover `ci.yml`'s 45 min timeout. 6.1's CI-fix loop is separately capped at 2 attempts, so no path runs a 4th review round.

**`pr-review.sh` timeout.** It spawns `claude -p` and takes several minutes. The default 120 s Bash timeout kills it mid-run and leaves a stale `/tmp/claude-review-N.lock`, so it runs with `timeout: 600000`.


## Stale inline comments (6.4; HON-585)

`select(.line != null)` is required: on a PR reviewed more than once, the earlier round's comments stay on the PR, and GitHub orphans them at `line: null` once the code they pointed at moves. Without the filter, 6.5 tried to open a file at a null line.


**Known limitation — this does not catch every stale comment.** A finding from an earlier round that was *addressed* but whose anchor merely shifted keeps `line != null`, and GitHub re-points its `commit_id` to the new head, so it is indistinguishable from a live finding. Filtering on `commit_id == head` does **not** help — verified on PR #667, where comment `3895696376` was addressed by `3a8f1f0` yet still reports `commit_id == head`, `line 417`. `isResolved` / `isOutdated` are both false on it too. Treat a re-reviewed PR's inline list as possibly containing settled findings, and check each against the diff before "fixing" it. Tracked in HON-585.

## Newest summary only (6.4; HON-586)

Each review round appends its own summary, so 6.4 reads `| last`. Dropping it concatenates every round, and the "No issues found" check is judged against verdicts from different commits. The same `| last` is why each round appends its Defer items to the deferrals file at once: a summary-only deferral from round 1 or 2 is unreadable once round 3 has posted, and `scripts/pr-review.sh` puts out-of-diff findings and anything past its 5-comment inline cap in the summary alone.


This is also why `scripts/pr-comments.sh` does not pass `--jq` to its paginated `gh api` call: gh runs `--jq` once per page, so `… | last` would yield the newest marker *on each page* rather than the newest overall — reinstating the same defect through a different door. The script folds the pages with `jq -s 'add'` first, so the caller's `last` runs against the whole set (HON-586).

## The pending-Vercel exemption (6.1, 7.2; HON-600)

**Known residual risk of that exemption (accepted in HON-600).** `gh pr checks` carries no signal separating "stuck after Ready" from "still deploying", so a Vercel build that is merely *queued* past the ~13 min `Lint, Type Check & Test` job is dropped along with a stuck one, and the merge lands before it reports. The exemption is still the right trade — Vercel builds here take 38 s–1 min, and the alternative stranded three finished PRs in one night — but the durable fix is HON-584 (required status checks on `main`), which makes GitHub itself refuse the merge. Same caveat applies to the `smoke` label: `preview-smoke.yml` is `on: deployment_status` gated on `state == 'success'`, so its checks never register while Vercel is pending and a labelled PR can merge without them. Requiring them instead would re-strand exactly the PRs this fixes, and `staging-smoke` still runs post-merge.

## No docs-only exemption (6.1, 7.2; HON-584, HON-1184)

The poll used to classify a PR as docs-only from its file list and, for such a PR, settle without the `Lint, Type Check & Test` row and on an empty check list. That existed only because `ci.yml` skipped docs-only PRs (`paths-ignore`, HON-529), and the file-list fetch grew two guards of its own (HON-587: the 100-file cap, then a partial pagination walk). HON-584 removed the path filter and made the job a required check, so the exemption turned harmful: a docs-only PR whose run had not registered by the second poll settled on an empty list, and GitHub refused the `gh pr merge` on the pending required check. HON-1184 removed the classification and its file-list fetch, so every PR waits for the same row.

## Spec findings (6.4; HON-1200, HON-1236)

The reviewer reports acceptance-criteria gaps under a `**Spec:**` heading: Missing, Not asked for, Implemented but wrong, Unproven. Missing and Implemented but wrong are correctness defects at every round, never deferred and never dropped by the round-3 bar, because the issue's own criteria are the scope. Unproven (HON-1236) means the criterion is implemented but nothing in the PR shows the result. It is coverage-only, so the round-3 bar may drop it with a `not actioned:` note. `scripts/pr-review.sh` tells the reviewer not to write "No issues found" beside a Spec entry or a "less usable" Usability verdict, but the merge decision is made in 6.4, so 6.4 does not depend on that.

## Merge gate (7.2, 7.3)

7.2 stops on any failing check, Vercel included, because `ci.yml` runs no `next build` and a failed Vercel deploy is the only build gate (the pending exemption is above). 7.2 does not enter the CI-fix loop, because a push in Phase 7 would merge a commit no review round has seen.

`.claude/hooks/block-destructive.mts` blocks every `gh pr merge` without an inline `WOBBLEPOT_ALLOW_MERGE=1` (HON-727). The hook reads the command text, so an `export` in an earlier Bash call does not carry over. In a worktree, `gh pr merge --delete-branch` fails because `gh` tries to check out main, which the parent checkout holds; GitHub still deletes the remote branch.

## Linear summary file list (7.4; HON-587)

`gh pr view --json files` is capped at 100 files and left that way on purpose: the list in the 7.4 summary is cosmetic, and truncating a changelog is not a merge gate. After the squash merge HEAD may no longer resolve the PR, so 7.4 uses the literal PR number from 6.2.

## What the HON-1230 cut dropped

- The Error Summary table at the end of `SKILL.md`. Most rows repeated a stop message that its own step carries. Two did not, "Commit/PR fails" and "Merge fails", so 5.4 and 7.3 gained their own stop lines: without one, a failed `gh pr merge` went on to print `[merge:complete]`, which `detect_phase` reads as done, and the PR stayed open with the run logged as a success.
- The list of fields to note in 2.1. The steps that use each field (the gate, 2.3, 3.1) name it where they use it.
- The Usage example's literal issue ID: `SKILL.md` carries no issue references, so it uses `<ID>`. `<ID>` is the same string the siblings write as `HON-XX`, so `/tmp/auto-implement-deferrals-<ID>.md` is the file `deferral.md` names.
