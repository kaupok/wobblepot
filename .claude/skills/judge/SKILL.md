---
name: judge
description: Give each open [AUTO DRAFT] issue (a review finding /auto-implement deferred) one cited verdict from recorded decisions (real, won't fix, send back, or hold) as a Linear comment and label. Runs only when invoked; never changes title, description, state or assignee.
argument-hint: '[HON-XX] [--dry-run] [--rejudge] | --fold | --backtest'
disable-model-invocation: true
context: inherit
---

# Judge

`/auto-implement` 6.8 files a deferred review finding as an `[AUTO DRAFT]` issue. A human clears the prefix in `/refine-backlog --auto-drafts`, and most answers already sit in the docs or in Linear. This skill finds that answer, quotes it, and posts it as a recommendation. The human still decides.

```
/judge                  # every open [AUTO DRAFT] issue with no Judge: label
/judge HON-XX           # that issue only
/judge --dry-run        # print each verdict, comment and label; write nothing to Linear
/judge --rejudge        # include issues that already have a Judge: label
/judge --fold           # turn overrules into one docs issue (below)
/judge --backtest       # replay past findings; read backtest.md first
```

Flags combine: `/judge HON-1456 --dry-run`.

Sibling files, read when they apply and before acting:

- `verdict.md`: the verdict JSON, the subagent prompt and the comment format (step 4)
- `gates.md`: the hard gates (step 2)
- `backtest.md`: `--backtest`
- `history.md`: why each rule exists; never needed for a run

## Verdicts

| Move | Label | When |
| --- | --- | --- |
| Decide — real | `Judge: real` | A recorded rule makes the finding a defect. |
| Decide — won't fix | `Judge: won't fix` | A recorded decision makes the behaviour intended. |
| Send back — `<reason>` | `Judge: sent back` | Stale (the code changed), a duplicate of an open issue, no evidence, or a misread of the code. |
| Hold — `<reason>` | `Judge: held` | No recorded decision covers it, the fix needs a product choice, or it hits a hard gate. |

**Write only one comment and one label per issue.** Never change the title, description, state, priority or assignee, and never clear `[AUTO DRAFT]`. A wrong verdict costs nothing until a human acts on it, and these limits keep it so.

## Mechanical checks

`pnpm judge` (`scripts/judge/cli.ts`) does every step that must not depend on a model. Each command reads JSON files and prints JSON:

- `pnpm judge select --issues <file> [--rejudge]`: keeps titles that start with `[AUTO DRAFT]` and drops issues with a `Judge:` label unless `--rejudge`.
- `pnpm judge gate --issue <file>`: the first hard gate the issue hits, or `null`.
- `pnpm judge finalize --verdict <file> [--ref <sha>] [--linear-dir <dir>]`: checks each citation, turns a Decide with no verified quote into Hold, and renders the comment and the label.

Do not do these steps by hand, and do not edit the script's output before you post it.

Make one scratch directory per run:

```bash
SCRATCH=$(mktemp -d /tmp/judge.XXXXXX) && echo "$SCRATCH"
```

A fresh shell loses the variable, so use the printed path in later commands.

## Step 1: Select issues

All issues:

```
mcp__linear-server__list_issues({ team: "Wobblebot", query: "[AUTO DRAFT]", includeArchived: false, limit: 100 })
```

Drop each result whose status is `Done`, `Canceled` or `Duplicate`. With `HON-XX`, `get_issue` that one issue instead.

Write the list as `[{ "id", "title", "labels" }]` to `$SCRATCH/issues.json`, then:

```bash
pnpm --silent judge select --issues "$SCRATCH/issues.json" [--rejudge]
```

Judge only `selected`. Print each `skipped` line, so the user sees why an issue got no verdict. No issue selected → print `[judge] Nothing to judge` and stop.

## Step 2: Gate check

For each selected issue, before any model call: `get_issue({ id, includeRelations: true })`, write `{ "title", "description", "labels" }` to `$SCRATCH/<ID>/issue.json`, and run:

```bash
pnpm --silent judge gate --issue "$SCRATCH/<ID>/issue.json"
```

A non-null `gate` is Hold. Write this verdict to `$SCRATCH/<ID>/verdict.json` and go to step 5. **No subagent runs for a gated issue.**

```json
{
  "issue": "<ID>",
  "move": "hold",
  "holdReason": "hard_gate:<gate>",
  "citations": [],
  "reasoning": "The issue hits the <gate> hard gate (<kind>: <matched>). A human decides these."
}
```

## Step 3: Read corrections

A correction is a verdict the user overruled. Pass the newest to every subagent, so the judge does not repeat a known mistake.

```
mcp__linear-server__list_issues({ team: "Wobblebot", label: "Judge overruled", limit: 50 })
```

For each, `list_comments`, find the `## Judge:` comment and the user's reply under it (a comment whose parent is the verdict). Keep the 30 newest, by reply date. Write them to `$SCRATCH/corrections.md`, one block each:

```
- HON-NNN (<date>): judge said "<the ## Judge: line>". User: "<the reply, verbatim>"
```

**Retire a folded correction.** An overruled issue with a related "Record N judge corrections in the docs" issue in `Done` is in the docs now. Leave it out of the file, and remove its `Judge overruled` label (`save_issue({ id, removeLabels: ["Judge overruled"] })`). Skip the removal on `--dry-run`.

## Step 4: Judge each issue with a subagent

One fresh subagent per issue, one at a time, so the main context keeps only verdicts:

```
Agent({ subagent_type: "general-purpose", model: "opus", run_in_background: false, description: "Judge <ID>", prompt: "<verdict.md → Subagent prompt, filled>" })
```

The subagent writes `$SCRATCH/<ID>/verdict.json` and replies with one line. Do not judge an issue in the main session: the verdict should not depend on what this conversation holds.

## Step 5: Verify citations and render

For each Linear citation in the verdict (a `source` that starts with an issue ID), and for `duplicateOf`, fetch the cited issue yourself: `get_issue` and `list_comments`. Write `Status: <status>` as the first line, then its description, then each comment body with its date, verbatim, to `$SCRATCH/<ID>/linear/<CITED-ID>.txt`. The subagent never supplies this text, so it cannot vouch for its own quote.

```bash
pnpm --silent judge finalize --verdict "$SCRATCH/<ID>/verdict.json" --linear-dir "$SCRATCH/<ID>/linear"
```

The script reads code and docs at `origin/main` (`git fetch origin main` first), drops each citation whose quote is not verbatim in its source, and holds a Decide with no verified citation, reason `no verifiable precedent`. A Send back — duplicate is held the same way unless it quotes `duplicateOf` and that issue is still open, because it closes the finding into another issue. A judge that invents a precedent is worse than no judge.

An `invalid verdict` error lists every problem. Send the subagent's prompt again once with the error appended. A second failure → Hold, reason `no_precedent`, with the error as the reasoning, and say so in the report.

## Step 6: Post

On `--dry-run`, print the verdict JSON, the label and the comment, and write nothing.

Otherwise, per issue:

```
mcp__linear-server__save_comment({ issueId: "<ID>", body: "<comment>" })
mcp__linear-server__save_issue({ id: "<ID>", addLabels: ["<label>"], removeLabels: [<any other Judge: label the issue has>] })
```

Post the comment first. A failed label after a posted comment → retry once, then name it in the report. `removeLabels` matters only on `--rejudge`: an issue carries one `Judge:` label. Never remove `Judge overruled` here; only step 3 does that.

## Report

```
[judge] <N> judged, <M> skipped<, dry run>
| Issue | Verdict | Cited |
| --- | --- | --- |
| HON-NNN <title, short> | Decide — real | docs/DESIGN.md → Copy |
```

Then each skipped issue and each failure. Name every issue by what it is, as CLAUDE.md → Writing style asks.

## `--fold`

Turns overrules into docs, so the next run reads the decision instead of a correction.

1. Read open `Judge overruled` issues and their replies, as in step 3, without the 30 cap.
2. Per correction, draft the doc text: a **Decision:** / **Why:** block under `docs/PROJECT_SPEC.md` → Key Decisions, or one line in the matching `docs/DESIGN.md` section. Name the target heading.
3. Show every draft to the user and ask in one round, with a recommended answer under each (`/refine-backlog` → Asking in rounds).
4. On approval, file one issue: title `Record <N> judge corrections in the docs`, state `Queued`, labels `Tech`, `relatedTo` each corrected issue. The body holds the exact text and the target heading per correction, per CLAUDE.md → Writing for Agents.

A GTM correction cannot exist, because GTM is a hard gate and so is never decided. Nothing private reaches the public repository. If a draft still names a price, market or cohort, drop it and tell the user.
