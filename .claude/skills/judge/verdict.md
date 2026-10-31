# Judge — verdict JSON, subagent prompt, comment

Read from `SKILL.md` → step 4. `pnpm judge finalize` validates the JSON and renders the comment, so this file and `scripts/judge/verdict.ts` change together.

## Verdict JSON

```json
{
  "issue": "HON-1456",
  "move": "decide | send_back | hold",
  "outcome": "real | wont_fix",
  "sendBackReason": "stale | duplicate | no_evidence | misread",
  "holdReason": "hard_gate:<name> | no_precedent | options_open",
  "duplicateOf": "HON-NNN",
  "citations": [
    {
      "source": "docs/DESIGN.md → Reject list | HON-NNN comment 2026-10-21 | src/lib/x.ts:42",
      "quote": "verbatim, at most 2 lines"
    }
  ],
  "reasoning": "at most 3 sentences"
}
```

- `outcome` only with `decide`. `sendBackReason` only with `send_back`; `duplicateOf` only with `duplicate`, and then a citation from `duplicateOf` is required, or the script holds the verdict. `holdReason` only with `hold`.
- `source` starts with a repository path or an issue ID, because the script reads the source from its first token. A doc cites a heading path (`docs/DESIGN.md → Copy → Sentence case`), not a line number, because doc lines drift. Code may cite `path:line`.
- `quote` is copied, not paraphrased. Whitespace may differ; nothing else may. A citation of the judged issue itself is dropped.
- The script adds `no_verifiable_precedent` itself. A subagent never writes it.

## Subagent prompt

Fill the `<…>` fields. The subagent has none of this conversation.

```markdown
You judge one Linear issue for the Wobblepot repository: <ID>. It is a review finding that an unattended agent deferred. Give it one verdict, from recorded decisions only. Do not edit any file except the verdict file, and do not write to Linear.

## Read

1. The issue: `mcp__linear-server__get_issue({ id: "<ID>", includeRelations: true })` and `list_comments`. `## Why it wasn't fixed here` says why the agent deferred it. `## What` may lay out options.
2. The code it cites, on `origin/main`: `git show origin/main:<path>`. Is the finding still current? Does the code do what the issue says?
3. The decision docs. Grep each for the issue's terms (`git grep -n -i <term> origin/main -- <files>`), then read only the matching sections: `docs/PROJECT_SPEC.md` (Key Decisions), `docs/DESIGN.md`, `docs/LOCALIZATION.md`, `docs/AI_VOICE_ET.md`, `docs/TYPOGRAPHY.md`, `docs/TRIAGE_RUBRIC.md`, `docs/AGENT_HISTORY.md`, `CLAUDE.md`, `.claude/rules/*.md`.
4. Linear: at most 5 `list_issues({ query })` searches and at most 5 issues read in full. Always read a Canceled or Duplicate match, because that is where a rejection lives. A Canceled state alone is not a decision: cite only a comment or description that says why.
5. Corrections the user made to earlier verdicts. Do not repeat these mistakes:

<contents of $SCRATCH/corrections.md, or "None.">

## Decide

- **decide / real**: a recorded rule makes the finding a defect. Cite the rule.
- **decide / wont_fix**: a recorded decision makes the behaviour intended. Cite the decision.
- **send_back**: `stale` (the code on `origin/main` no longer does it; cite the current code), `duplicate` (an open issue covers it; set `duplicateOf` and quote that issue), `no_evidence` (the issue names no file, line or reproduction), `misread` (the code does not do what the issue says; cite it).
- **hold**: `no_precedent` (nothing recorded covers it), `options_open` (the fix needs a product or design choice). Hold is a good answer. Do not stretch a weak precedent into a Decide.

A Decide needs at least one quote that is verbatim in the cited file on `origin/main` or in the cited Linear issue. Never cite <ID> itself: the finding is not its own precedent. The quote is checked by a script; an invented or paraphrased quote turns the verdict into Hold.

## Write

Write the verdict JSON, in the schema in `.claude/skills/judge/verdict.md`, to `<$SCRATCH>/<ID>/verdict.json`. `reasoning` is at most 3 sentences. Reply with one line: `<ID>: <move> <outcome or reason>`.
```

## Comment

`pnpm judge finalize` renders it; never write it by hand. The first line is what `/refine-backlog` and `/judge --fold` match, as other skills match `# Plan:`.

```markdown
## Judge: <Decide — real | Decide — won't fix | Send back — <reason> | Hold — <reason>>

**Citations:**

- docs/DESIGN.md → Copy
  > Sentence case for all UI text.

**Reasoning:** <at most three sentences>

**Dropped citations** (not verified, so not used):

- <source>: <why>

To overrule: reply under this comment with the right answer and one line of why, then add the `Judge overruled` label.
```

`Dropped citations` appears only when the script dropped one. Send back reads `stale`, `duplicate of HON-NNN`, `no evidence` or `misread`. Hold reads `hard gate: <name>`, `no precedent`, `options open` or `no verifiable precedent`.
