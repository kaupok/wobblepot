# Auto-implement — review round 3 and the cap (6.4, 6.5, 6.7)

Read from `SKILL.md` once `ROUND` ≥ 3, or when 6.6 branch C routes to the 6.7 hand-off.

## Materiality bar (6.4)

**Materiality bar — applies from ROUND 3 on.** On rounds 1 and 2 every substantive finding is an Address Now item, per the `SKILL.md` 6.4 triage rules. From round 3 the bar rises, because by then the cheap defects are gone and what is left is usually accretion:

- **Action it** only if it is a **correctness or safety defect** — wrong behaviour, a broken reference (a path, line number, step number, or command that does not resolve), a factual error in the text, a security or data-loss risk.
- **Do not action it** if the fix only adds coverage, edge cases, hedging, or qualification to something that already works as written. "This grep would also miss X", "this does not cover the case where Y", "consider noting Z" are coverage-only by definition.

The bar exists because the reviewer is asked "what is wrong with this?" and never "is this now worse than it was three rounds ago?" — an asymmetry that makes the loop self-sustaining. Each HON-627 finding was individually defensible; together they improved grep recall and destroyed the artifact's usability, which was the entire point of the artifact. A finding that makes a document longer and harder to follow is a finding worth dropping.

**What the bar decides, given the cap.** Two things. It decides *what gets written into the artifact* on the way out — the thing HON-627 actually lost was not the routing but three rounds of accretion appended after the document had stopped improving. And because 6.6 branch C sends a round-3 PR to 6.7 only when something is left **unresolved**, it also decides whether the run merges or hands off: a coverage-only finding dropped here with a `not actioned:` note is resolved, so the PR merges. Chasing it instead would leave the artifact longer and, if it could not be settled, strand the run for a human to close by hand.

Record the call rather than silently skipping it — see the `not actioned:` convention below.

## `not actioned:` convention (6.5)

**The `not actioned:` convention — required for every finding the 6.4 materiality bar drops.** A skipped finding must read as a decision, not an oversight, or the next reviewer (or the human picking up a 6.7 hand-off) re-raises it and the loop restarts by hand.

For a finding that came in as an **inline comment**, reply on that comment so the note sits next to the code it declines to change:

```bash
# Substitute the literal PR number and the inline comment's `id` from 6.4's fetch.
gh api "/repos/:owner/:repo/pulls/<PR_NUMBER>/comments/<COMMENT_ID>/replies" \
  --method POST \
  -f body="not actioned: coverage-only, round >= 3 — <one line on what the finding asked for and why it is coverage rather than correctness>"
```

For a **summary-only finding** there is no comment to reply to, so post the note as an issue-level comment on the PR **here, in 6.5** — do not defer it to 6.7, which runs only when something is left unresolved and therefore never runs on the expected "everything resolved → merge" path:

```bash
# Substitute the literal PR number. One comment covers every summary-only drop in this round.
gh api /repos/:owner/:repo/issues/<PR_NUMBER>/comments \
  --method POST \
  -f body="not actioned: coverage-only, round >= 3

- <finding> — <why it is coverage rather than correctness>"
```

Keep the `not actioned: coverage-only, round >= 3` prefix literal — it is what makes the decisions greppable across PRs when judging whether the bar is set right, and that only works if the note is posted on every path, including the one that merges.

## 6.7 hand-off

Reached only from 6.6 branch C, and only when a **correctness or safety finding is still unresolved** at the cap. It is a **designed exit, not a crash**: the work is committed, CI is green, and the PR is left open for a human to judge. Getting here in ~25 minutes instead of 2h45m is the entire point, and the `Stranded` label and its recovery path already exist and need no change.

**It is not free, though, and must stay rare.** `scripts/orchestrator.sh` `strand_worker` treats an unmerged run as a failure to ship: it logs `[OUTCOME] … STRANDED`, calls `note_consecutive_failure` (three in a row trips the circuit breaker at `MAX_CONSECUTIVE_FAILURES=3`), sets `ONCE_EXIT_CODE=1`, and deliberately skips `cleanup_worker_worktree` — so every hand-off leaves a worktree, a local branch and a Neon branch that only `wt cleanup <branch>` reclaims. That cost is why 6.6 branch C merges when round 3's findings were all resolved: of the last 13 PRs, only HON-627 would reach 6.7, and the two that used three rounds shipped without a human. If runs start landing here regularly, the answer is to look at why the reviewer keeps finding unresolvable things, not to raise the cap.

**First run 6.8** and file any deferrals, so the IDs can go in the comment below. 7.6 is never reached on this path, so this comment is the only place the human learns the run created follow-up issues.

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

**Deferred to follow-up issues (6.8):**
- [one line per \`[AUTO DRAFT]\` issue filed, with its HON-ID, or 'none']
- [any deferral 6.8 did not file, with why: over the 3-issue cap, skipped as a duplicate of an existing HON-ID, or a filing failure — 7.6 never runs on this path, so if it is not written here it is written nowhere]

To finish: review the above, then merge, or push a fix and merge. If this run was orchestrated it also carries the \`Stranded\` label and a preserved worktree — release it with \`wt cleanup <branch>\` and clear the label once the PR is settled, or nothing reclaims either."
```

Post the same summary as a Linear comment on the issue, then stop:

```
mcp__linear-server__save_comment({ issueId: "HON-XX", body: "[the same hand-off summary]" })
```

**Do not change the issue's Linear state.** Linear moved it to `In Review` when the PR opened, which is accurate — a PR is open and unmerged — and `strand_worker` deliberately leaves that state alone when a PR exists (`scripts/orchestrator.sh`, the comment above its `restore_queue_if_in_progress` call). The `Stranded` label is what flags the issue for pickup, and the orchestrator adds it on a clean worker exit as well as a timeout, so reaching 6.7 and stopping is enough to get it. The orchestrator gives most first strands one automatic finish attempt instead (HON-1065), but it skips that attempt when the worker log carries a hand-off line: `[auto-implement] PR left open`, or a `[auto-implement] ⚠` line that says `Review-round cap reached` or `handing off`. Print the markers below exactly, so the orchestrator does not send a finish worker to merge a PR left for a human.

```
[auto-implement] ⚠ Review-round cap reached (3/3) — handing off
[auto-implement] PR left open with a hand-off comment; not merged
[auto-implement] ✗ Autonomous implementation cycle stopped at Phase 6 (review-round cap)
```

Stop here. Do not proceed to Phase 7. This message ends the turn — it is a terminal marker, so the Execution Model rule against ending a turn on in-flight work is satisfied.
