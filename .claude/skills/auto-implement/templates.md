# Auto-implement — templates (2.7, 7.4, 7.6)

Read from `SKILL.md` at the step named in each heading. `<ID>` is this issue's identifier.

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

[From the step 7b scan in 2.6. Group by Mirror / Override / Deliberate with a `file:line` and a one-line reason each — the Deliberate bucket is only useful with the reason. If the scan ran and found nothing, write `none — no callsite hardcodes the changed <property>`, naming the property scanned; without that line a clean scan looks like one that never ran. Omit entirely only if the issue changes no primitive geometry, `@theme` token, or shared layout wrapper.]

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
