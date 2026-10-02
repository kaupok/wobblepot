# Auto-implement — the incidents behind the rules

Read before changing or disputing a rule in `SKILL.md` or its sibling files. Nothing here is needed to run a cycle.

## Terminal turns (Execution Model; HON-562, HON-573)

A headless worker exits the moment its turn ends, so ending a turn beside in-flight work loses either the work or the merge. Both halves of that have already cost a run:

- **Uncommitted work is destroyed.** HON-562's first run ended a turn with "E2E is still running — I'll pick up when it lands" and lost a fully green batch (2026-08-30).
- **A finished PR is stranded.** HON-570 (PR #650) and HON-571 (PR #651) ended their turns beside a Phase 6.1 CI poll. HON-570's worker exited 36 seconds later — before the poll's opening `sleep 30` had even elapsed. Both PRs sat open and unmerged until a human merged them by hand ~45 minutes later (HON-573).

## Sync with origin/main (0.4)

**Why this matters:** Branching from a stale local main means every subsequent tool (Explore, planning, codebase grep) searches an outdated tree. If a related or epic-sibling issue landed on origin/main since you last pulled, its files, migrations, conventions, and constants won't be visible. At PR time you'll hit merge conflicts and schema collisions on code you didn't know existed — exactly the HON-500 ↔ HON-501 migration collision that motivated this step.

## Sibling overlap check (2.3)

**Why:** When an issue is part of an epic (has `parentId`) or has `relatedTo` links, a sibling issue may have already landed and introduced files, conventions, schema, or constants that your plan needs to build on rather than duplicate. `blockedBy` is checked by Phase 1's selection filter, but `relatedTo` / epic-siblings are not — and a Done sibling in the same epic is a strong "check for overlap" signal. The HON-500 ↔ HON-501 incident (duplicate `Household.locale` schema change, duplicate `locales.ts`) is what motivated this step.

## The review-round cap (Phase 6; HON-627, HON-630)

Phase 6 is the only loop in this skill: 6.3 reviews, 6.4 triages, 6.5 fixes, 6.6 pushes and comes back to 6.3 for the next round. It has to be bounded, because its natural exit — "the reviewer eventually runs out of findings" — only exists when there is an **oracle**: a failing test, a type error, a broken selector. On a prose or heuristic deliverable there is always another defensible finding, so the loop runs until something external kills the worker. HON-627 took **14 rounds over 2h45m** and ended `Stranded` with a green, mergeable PR (#707) that a human had to merge by hand — and its findings, each defensible on its own, grew the artifact until it was no longer usable. For contrast, the 12 PRs before it took 1 round (nine of them), 2 rounds (one), and 3 rounds (two): three rounds covers every PR that has ever converged here.

**ROUND is the number of `<!-- claude-review -->` comments on the PR once 6.3 has posted the current one** — the count 6.3 already fetches to verify the review landed. Deriving it from GitHub rather than from a local counter means it survives process death and context summarization within a run, and that it counts rounds this run did not perform: a manual `/review-pr`, or an earlier worker on the same branch. (It is not a resume mechanism in its own right — Phase 2.1 stops on `In Review`, so an open PR re-enters Phase 6 only through an orchestrator retry, which resumes at 6.1 per `recovery.md` → Retry context. Its earlier rounds are on the PR and still count.)

A counter that can stall is not a cap, so 6.3 requires `ROUND` to be **strictly greater** than the count taken before the run and stops the cycle if it is not. That is what makes each iteration consume budget and the loop provably terminate; the stale-lock path that can otherwise freeze it is described there.

**The cap bounds reviews, not merges.** Round 3's findings can still be fixed and shipped — what the cap forbids is asking for a *fourth opinion* on the result. That distinction is load-bearing: the two 3-round PRs in the recent history (#704, #700) each merged by fixing round 3's findings and merging without re-reviewing, so a cap that also blocked the merge would strand runs that converged perfectly well.

The 6.6 branch C merge path: Round 3's fix ships without a 4th review, which is exactly how the two 3-round PRs in the recent history converged (#704: review `08:03:05Z` → fix `08:10:50Z` → merged `08:20:04Z`; #700: `22:23:34Z` → `22:28:03Z` → `22:37:06Z`). Stranding these would triple the hand-off rate for no gain and walk the orchestrator toward `MAX_CONSECUTIVE_FAILURES`.

## Stale inline comments (6.4; HON-585)

**Known limitation — this does not catch every stale comment.** A finding from an earlier round that was *addressed* but whose anchor merely shifted keeps `line != null`, and GitHub re-points its `commit_id` to the new head, so it is indistinguishable from a live finding. Filtering on `commit_id == head` does **not** help — verified on PR #667, where comment `3895696376` was addressed by `3a8f1f0` yet still reports `commit_id == head`, `line 417`. `isResolved` / `isOutdated` are both false on it too. Treat a re-reviewed PR's inline list as possibly containing settled findings, and check each against the diff before "fixing" it. Tracked in HON-585.

## Newest summary only (6.4; HON-586)

This is also why the fetch cannot be written as `--paginate --jq '… | last'`: gh runs `--jq` once per page, so `last` would yield the newest marker *on each page* rather than the newest overall — reinstating the same defect through a different door. The `jq -s 'add'` form evaluates `last` against the whole set (HON-586).

## The pending-Vercel exemption (6.1, 7.2; HON-600)

**Known residual risk of that exemption (accepted in HON-600).** `gh pr checks` carries no signal separating "stuck after Ready" from "still deploying", so a Vercel build that is merely *queued* past the ~13 min `Lint, Type Check & Test` job is dropped along with a stuck one, and the merge lands before it reports. The exemption is still the right trade — Vercel builds here take 38 s–1 min, and the alternative stranded three finished PRs in one night — but the durable fix is HON-584 (required status checks on `main`), which makes GitHub itself refuse the merge. Same caveat applies to the `smoke` label: `preview-smoke.yml` is `on: deployment_status` gated on `state == 'success'`, so its checks never register while Vercel is pending and a labelled PR can merge without them. Requiring them instead would re-strand exactly the PRs this fixes, and `staging-smoke` still runs post-merge.
