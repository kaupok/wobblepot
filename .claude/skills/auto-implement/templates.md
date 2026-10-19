# Auto-implement — templates (2.6, 2.7, 7.4, 7.6)

Read from `SKILL.md` at the step named in each heading. `<ID>` is this issue's identifier.

## Explore prompt (2.6)

Fill the `<…>` fields from the issue, its comments and 2.3, and drop a section that does not apply. The subagent has none of this conversation, so the prompt names everything it needs.

```markdown
Read-only exploration for <ID>: <issue title>. Do not edit files. I will write the implementation plan from your answer alone, so be specific and short: under 600 words, no file dumps.

## The issue

<What the issue asks for, in 2-4 sentences>
Files and functions it names: <paths, symbols>
Acceptance criteria:
<each criterion, one per line>

## Read first

- `docs/PROJECT_SPEC.md`, for the product context of this area
- The docs that CLAUDE.md → Documentation Structure names for this kind of change

## Return

1. **Files to change**: each with `path:line` anchors and what changes there
2. **Pattern to copy**: one existing reference file that already does the same kind of thing, with `path:line`
3. **Tests and stories**: the tests, stories and E2E specs that cover this area, and which ones the change makes stale
4. **Sibling changes**: <sibling ID> (merged PR #<N>) touched <paths>. Run `git log --oneline --since="14 days ago" -- <paths>` and `git diff origin/main~<N>..origin/main -- <paths>`, and say what it added that the plan must extend, not duplicate
5. **Coupled callsites**: this issue changes <the primitive, token or wrapper and its old value>. Run `.claude/skills/plan-issue/SKILL.md` step 7b's greps against the old value and return each hit as Mirror, Override or Deliberate with `path:line` and a one-line reason, or `none — no callsite hardcodes <property>`
6. **Doc rules**: any CLAUDE.md or docs rule this change must follow, in one line each
```

Items 4 and 5 go in only when 2.3 flagged a merged sibling or the issue changes shared primitive geometry. The brief's item 5 becomes the plan's `## Coupled callsites`.

## Plan (2.7)

```markdown
# Plan: <ID> - [Issue Title]

**Issue:** <ID>
**Branch:** `[gitBranchName from Linear]`

## Context

[2-3 sentence summary of the issue and relevant background]

## Design Decisions

| Decision       | Choice        | Rationale |
| -------------- | ------------- | --------- |
| [Key decision] | [Your choice] | [Why]     |

## Follow-ups

[One line per step this issue needs that does not ship in this PR: `- <follow-up ID> — <the step> (Queued | Todo)`. Draft it as `- to file: <the step> (Queued | Todo)`; 2.8 files it and swaps in the ID. Write `None` when every step ships in this PR. Every "not in this PR" row in Design Decisions has a line here, unless the row says why the step is not needed at all: a deliberate scope cut is not a follow-up, and filing one Queued would skip the `[AUTO DRAFT]` review.]

## Files to Create

- `src/path/to/new/file.tsx` - [Purpose]

## Files to Modify

- `src/path/to/existing/file.ts` - [What changes]

## Implementation Steps

1. [Specific step with details]
2. [Specific step with details]

## Tests

- `src/path/to/file.test.ts` - [What to test]

## Coupled callsites

[From the step 7b scan in the 2.6 Explore brief. Group by Mirror / Override / Deliberate with a `file:line` and a one-line reason each — the Deliberate bucket is only useful with the reason. If the scan ran and found nothing, write `none — no callsite hardcodes the changed <property>`, naming the property scanned; without that line a clean scan looks like one that never ran. Omit entirely only if the issue changes no primitive geometry, `@theme` token, or shared layout wrapper.]

## Verification

- [One line per acceptance criterion: the command, test, story or spec you will run to show it holds]
- [Edge cases, and the test that covers each]
```

`## Verification` is a plain list, not checkboxes, of what **you** will run. It becomes the PR's "Verified" list in 5.4, so a step only a human could perform does not belong here; a criterion this session cannot check goes under "Not verified".

## Linear summary comment (7.4)

```markdown
## Merged: PR #XX — type(scope): Title

**PR:** [#XX](url)

### Summary

[2-3 sentence plain-language summary of what was done and why. Describe the user-facing or architectural impact, not just "changed files". This should read like a mini changelog entry.]

### Proof
- [criterion, quoted or shortened] — measured: `pnpm test src/lib/x.test.ts` went red on the literal 3/4 before the change and green after (test name)
- [criterion] — measured: Driven: /shopping-list — ticked "Milk"; counter read 3/4. Screenshot on this issue.
- [criterion] — inferred: no test asserts it; the route returns the field and the client reads it (file:line)
- [criterion] — not proven: needs a staging walk-through (why)

### Changes
- X files changed
- [file list with +/- stats from gh pr view --json files]

### Commits
- [commit messages from gh pr view --json commits]

### Review feedback addressed
- [summary of review comments that were addressed, or "No review feedback" if none]

### Follow-ups
- [One issue ID per line. Or "None".]
```

- `### Proof` has one line per acceptance criterion of the issue, in the issue's order, and each line carries exactly one label. `measured`: a command, test or browser action, with its output quoted. `inferred`: reasoning from code, with the file and line. `not proven`: the reason. A criterion with no line is a gap the reader can see, so do not leave one out. Take the lines from the cycle's own test runs (3.2, 4.5, 6.6) and `Driven:` lines; run nothing new for the summary. Write "went red before the change" only when the cycle ran the test before the change; otherwise quote the green run.
- `### Follow-ups` holds issue IDs only, from 2.8, 3.2 and 6.8. A post-merge step with no issue is never written there as text: it was filed at 6.8, or 6.8 failed and the 7.6 report says so.
- Keep it concise: list files and stats, not full diffs.
- Print the summary to the terminal as well. If the Linear call fails, the terminal copy still stands; do not block the merge flow.

## Filing report (7.6)

Print before the completion block when the run filed a follow-up, or 6.8 filed anything, skipped a duplicate, hit the 3-issue cap or failed to file. Omit a list that is empty. A clean PR review alone does not mean there is nothing to report, because 4.4's deferrals reach 6.8 on that path too.

```
Follow-ups:
- Filed: <follow-up ID> (Queued, blocked by <ID>)
- Not filed: [one line per follow-up whose filing failed — it has no issue, so the operator must file it]

Deferred findings:
- Filed: <finding ID>, <finding ID>
- Already tracked: <existing ID> (skipped as duplicate)
- Not filed (over cap): [one line per remaining finding]
```
