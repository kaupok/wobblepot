# Auto-implement — filing deferred findings and follow-ups (6.8)

Read from `SKILL.md` → 6.8 when `/tmp/auto-implement-deferrals-HON-XX.md` holds anything, and from 2.8 and 3.2 when the run has a follow-up to file.

The file holds two kinds of block, and they are filed differently:

- **A deferred finding** — something wrong or missing that a review pass noticed and 4.4 or 6.4 put out of scope. It is filed as an `[AUTO DRAFT]` issue in Backlog: the rules below, down to [Follow-ups](#follow-ups-kind-follow-up).
- **A follow-up** — a block tagged `kind: follow-up`: a step this issue needs that the PR does not ship. It is filed by [Follow-ups](#follow-ups-kind-follow-up), without the prefix.

Everything deferred during the run gets filed as a Linear issue before the merge. One sink, written by 4.4 and by every 6.4 round:

```bash
cat /tmp/auto-implement-deferrals-HON-XX.md 2>/dev/null || echo "(no deferrals)"
```

Read it rather than the conversation, and rather than the PR: Phase 5 and up to three CI waits sit between 4.4 and here, and 6.4's summary fetch keeps only the newest round, so an earlier round's summary-only deferral is no longer on any readable surface. File once, here; do not file from Phase 4 or 6.4, or the same finding lands twice. Delete the file once the issues are filed, so a resumed run cannot double-file them.

A deferral that exists only in a PR comment is gone the moment the PR merges. The bucket exists precisely for findings that are real but out of scope, and a real finding with no ticket is one nobody will see again.

**Filing is not cheaper than fixing.** The effort-first rules in 4.4 and 6.4 still decide the bucket, and this step does not soften them. An `[AUTO DRAFT]` issue for something that was a five-minute fix is a defect in the cycle, not an output.

**Cap: 3 issues per cycle.** Follow-ups do not count toward it and are never dropped by it. A cycle that files six tickets per PR grows the backlog faster than the cycle drains it. Run the duplicate check below across every deferral **first** — a duplicate adds nothing to the backlog, so it must not consume a slot — then, if more than three still survive, rank by the priority you would assign each one (2 before 3 before 4), break ties by putting correctness and data-loss findings ahead of everything else, and file the top three. List the remainder in the 7.6 report as unfiled, one line each — they are not lost, they are handed to the operator.

**Check each one isn't already filed.** A deferred finding often names a pre-existing condition, and the review pass has no memory of the backlog:

```
mcp__linear-server__list_issues({ query: "<distinctive phrase from the finding>", limit: 10 })
```

`query` searches the whole workspace and returns closed issues too, so read each match's `status` before acting on it. A match in `Backlog` / `Todo` / `Queued` / `In Progress` / `In Review` is a live duplicate — skip filing and note the existing ID in the 7.6 report. A match in `Done` / `Canceled` / `Duplicate` is **not** a duplicate: the finding has resurfaced after that issue closed, which is worth its own ticket. File it, and reference the closed issue in `## Context`.

**Create it:**

```
mcp__linear-server__save_issue({
  team: "Wobblebot",
  title: "[AUTO DRAFT] <sentence-case description of the problem>",
  description: "<body — required sections below>",
  state: "Backlog",
  priority: <2-4, matching severity>,
  labels: ["Bug"],
  relatedTo: ["HON-XX"],
})
```

- **The `[AUTO DRAFT]` prefix is mandatory.** It is the only trace that an agent filed the issue rather than a human, and it is what the selection filters key on (1.5 here, step 5 in `/next-issue`). Never file without it, and never strip it yourself — `/refine-backlog --auto-drafts` removes it once a human has reviewed the issue.
- **`state: "Backlog"`, never `Queued` (or `Todo`).** Queued means a human decided the work should run unattended, and Todo that a human intends to do it. This step has no authority to make either call.
- **Unassigned** — do not pass `assignee`.
- **Never `priority: 1` (Urgent).** An autonomous cycle does not get to page anyone. If a finding genuinely looks urgent, file it at 2 and say so in the 7.6 report.
- **`relatedTo` the issue this cycle was implementing**, so the finding's origin is traceable from both ends.
- **`labels`** — reuse an existing label that fits (`Bug`, `Improvement`). Omit the field rather than inventing a new label.

**Required body sections.** An `[AUTO DRAFT]` still has to clear the "Writing for Agents" bar in CLAUDE.md: it will be picked up later by an agent with none of this session's context.

| Section | Contains |
| --- | --- |
| `## Problem` | The finding, with file paths and line numbers — what breaks, and under what conditions. |
| `## Why it wasn't fixed here` | The deferral justification: which review round raised it, the effort estimate, and why it fell outside this PR's scope. State plainly whether it is pre-existing or introduced by this PR. |
| `## What` | The concrete fix. Where the fix needs a product or design decision, lay out the options instead of picking one. |
| `## Acceptance criteria` | Testable outcomes, including the standard `pnpm lint && pnpm type-check && pnpm test` line. |
| `## Context` | The PR number, the parent `HON-XX`, and the review round the finding came from. |

Reference other issues as plain text (`HON-NNN`), never as hand-copied `<issue id="…">` tags — Linear auto-resolves plain text on save, and a copied UUID controls where the link points, so a reference can look right in review and click through to the wrong issue (CLAUDE.md, Git & Workflow Essentials).

**Never nest a markdown table inside a list item.** Linear's description parser silently strips the list item's content indent — 3 characters under `1. `, 2 under `- ` — off the front of every table _body_ cell. The header and delimiter rows survive, so the table still looks right while `` `MealForm.tsx:153` `` has become `` alForm.tsx:153` ``: data loss, not a rendering glitch, and nothing reports it. That lands hardest here — 6.8 files unattended, and the `## Problem` section above is specified as file paths and line numbers, which is exactly the payload that gets eaten. Put any table you add to the issue body at top level, or use a nested bullet list. See CLAUDE.md → Writing for Agents.

## Follow-ups (`kind: follow-up`)

CLAUDE.md → "A follow-up is an issue" is the rule. This section is how the unattended cycle applies it.

**What is a follow-up, and what is not.** A follow-up is a step that a doc rule or the parent's acceptance criteria require, and that this PR does not ship: re-record a golden after a prompt change (`docs/AI_MODELS.md` → Record the golden), run a backfill after a migration. The cycle produces it on purpose, as part of finishing the parent. A review finding is never a follow-up, even when the fix happens after merge. If the block cannot name the rule or criterion in its `why:` line, it is a finding: file it as one.

The distinction matters because the two get different gates. `[AUTO DRAFT]` exists to keep work the cycle *noticed* out of unattended pickup until a human judges it, and that gate stays. A follow-up is not new work the cycle invented: a human queued the parent, and the follow-up is the rest of it. So it takes no prefix and gets the state the CLAUDE.md rule gives it, which may be Queued. A follow-up that only says "fix this later" is a finding with the wrong tag, and filing it Queued would let the cycle implement its own findings unreviewed.

**Where it comes from, and when it is filed:**

| Found in | Filed |
| --- | --- |
| The 2.7 plan (`## Follow-ups`) | At 2.8, before the plan is posted, so the plan carries the ID |
| Phase 3, while implementing | At once, in 3.2. Not through the file: 4.4 truncates it after Phase 3 |
| 4.4 or 6.4 triage | Appended to the file as a `kind: follow-up` block, filed here at 6.8 |

Block format in the file:

```markdown
## <the step, sentence case>

kind: follow-up
why: <the doc rule or acceptance criterion that requires it>
state: Queued | Todo
needs-merge: yes | no
<what to run, on which commit, and how to check it is done>
```

**Check it isn't already filed.** An orchestrator retry re-runs Phase 2, so a plan-time follow-up can already exist. Re-fetch the parent with `get_issue({ id: "HON-XX", includeRelations: true })` and skip any follow-up whose title is already in `relations.blocks` or `relations.relatedTo`.

**Create it:**

```
mcp__linear-server__save_issue({
  team: "Wobblebot",
  title: "<sentence-case step, no prefix>",
  description: "<## Problem, ## What, ## Acceptance criteria, ## Context — name HON-XX and the PR>",
  state: "Queued",            // or "Todo" when a human must act (credentials, spend approval, a judgment call)
  blockedBy: ["HON-XX"],      // needs-merge: yes — use relatedTo: ["HON-XX"] instead when it does not
  priority: <the parent's priority>,
  labels: [<the parent's labels>],
})
```

- **No `[AUTO DRAFT]` prefix.** Only findings take it.
- **`blockedBy` the parent in this same call** when the step needs the parent's change on `main`. The orchestrator picks up a Queued issue within a minute, so without the relation it runs before the parent merges (HON-902 for the same-call rule, HON-1053 for the incident).
- **Unassigned.** A human picks up a Todo follow-up; the orchestrator picks up a Queued one.
- The body clears "Writing for Agents" in CLAUDE.md: the agent that picks it up has none of this session's context.

**Put the ID in the PR body.** 2.8 and 3.2 filings reach the PR at 5.4. A follow-up filed here at 6.8 is after 5.4, so add it to the Summary's `**Follow-ups:**` line with `gh pr edit <PR_NUMBER> --body-file <file>`. On the 6.7 hand-off path, also list it in the hand-off comment.

**A filing failure.** At 6.8 it does not block the merge, as for findings: print the unfiled body, and say in the 7.6 report that the follow-up has no issue. At 2.8 the plan is not posted: retry once, then stop with the 2.8 error. In 3.2, retry once, then carry the block into the deferrals file after 4.4's truncation so 6.8 tries again.

## Report and exit

Report what was filed:

```
[auto-implement] Filed N deferred finding(s): HON-AA, HON-BB
[auto-implement] Filed N follow-up(s): HON-CC
```

When neither 4.4 nor 6.4 deferred anything, this step is a no-op — a clean PR review alone does not mean that, since 4.4's deferrals arrive here too:

```
[auto-implement] No deferred findings to file
```

**A filing failure never blocks the merge.** The PR is green and reviewed by this point; holding it back because Linear returned an error trades a shipped fix for a bookkeeping entry. If `save_issue` fails, retry once, and if it fails again print the full issue body you were trying to file so the operator can paste it in, then continue — on the failure path as on the success path, by the exit rule below:

```
[auto-implement] ⚠ Could not file deferred finding(s) — Linear error: <message>
[auto-implement] Unfiled body follows, copy into Linear manually:
<the full title + description>
```

**Then leave by the door you came in.** 6.8 has two exits, and taking the wrong one is how a hand-off turns into an unwanted merge:

- **Entered from 6.7** — go **back to 6.7**: post the hand-off comment with the filed IDs, print 6.7's markers, and stop. **Do not continue to Phase 7.** That path is holding the PR open because a correctness or safety finding is unresolved; merging it here would also skip `strand_worker`'s label and worktree preservation.
- **Entered from any other path** (6.4 clean-review, 6.6 branch B, 6.6 branch C resolved) — continue to Phase 7 and merge.
