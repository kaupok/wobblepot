---
name: bench-judge
description: Judge the model benchmark's exported imagine and tips pairs in Claude Code (billed to the subscription, not the API key) and import the verdicts into the report. Use after `pnpm bench:models --judge` has written a `.judge-pairs.json`.
context: inherit
---

# Bench judge

`pnpm bench:models --judge` runs the benchmark through the API key and exports every judge prompt to `scripts/model-bench/results/<stem>.judge-pairs.json` instead of paying Opus to answer them. This skill answers them with subagents and runs `pnpm bench:models --import-verdicts`, which fills the report's Judge section. Background: `docs/AI_MODELS.md` → The judge.

## Usage

- `/bench-judge` — the newest `*.judge-pairs.json` under `scripts/model-bench/results/`
- `/bench-judge scripts/model-bench/results/<stem>.judge-pairs.json` — that file

## Blindness rules

The comparison is only worth something if nobody judging knows which answer came from which model.

- **Read only the pairs file.** Until the import has run, do not open `<stem>.json` (it holds `judgeKey`, which says which model sat as A), `<stem>.md`, or `scripts/model-bench/cases/`. If you have already read any of them this session, say so and stop: a fresh session has to judge.
- Each prompt is answered on its own `system` + `prompt`, verbatim, by a subagent that reads nothing else. The id `<caseId>#<run>#<a|b>` is for bookkeeping; the letter is the export order, not a role.
- Do not reword a prompt, add context, or merge prompts that share a case. Do not answer them yourself from the main session: judge quality should not depend on what else this conversation holds.

## Workflow

### 1. Locate the pairs file

```bash
ls -t scripts/model-bench/results/*.judge-pairs.json | head -1
```

Read its `verdictsFile` and `items.length`. Stop with a message if `items` is empty (every pair had an errored side; the import still works and reports them as skipped).

### 2. Split the prompts per case

One slice per case keeps each subagent's input small. In the scratchpad directory (`$SCRATCH` below):

```bash
node -e '
const fs = require("fs"), path = require("path");
const [pairs, out] = process.argv.slice(1);
const { items } = JSON.parse(fs.readFileSync(pairs, "utf8"));
fs.mkdirSync(out, { recursive: true });
const byCase = new Map();
for (const it of items) { const c = it.id.split("#")[0]; (byCase.get(c) ?? byCase.set(c, []).get(c)).push(it); }
let n = 0;
for (const [c, its] of byCase) { fs.writeFileSync(path.join(out, `${++n}.json`), JSON.stringify({ items: its }, null, 2)); console.log(`${n}.json ${c} ${its.length}`); }
' scripts/model-bench/results/<stem>.judge-pairs.json "$SCRATCH/bench-judge"
```

### 3. Judge each slice with a subagent

For every slice, spawn an `Agent` (`subagent_type: general-purpose`, `model: opus`), up to five at a time, with this prompt — fill in the two paths:

> Read `<slice>.json`. It holds `items`, each with an `id`, a `system` and a `prompt`. For each item independently: treat `system` as your complete instructions and `prompt` as the request, and decide the verdict it asks for. Judge each item on its own; do not compare items with each other, do not read any other file, and do not use any tool other than reading that file and writing the result. Write `<verdicts>.json` containing exactly `{"verdicts":[{"id":"<id>","winner":"A"|"B"|"tie","reason":"<one sentence>"}, ...]}` with one entry per item, in order, and reply with the single word `done`.

Use `<slice>.verdicts.json` beside each slice for `<verdicts>`. The subagent's reply is deliberately one word so the verdicts never enter this context; they are merged from the files.

### 4. Merge and validate

```bash
node -e '
const fs = require("fs"), path = require("path");
const [pairs, dir, judge] = process.argv.slice(1);
const { items, verdictsFile } = JSON.parse(fs.readFileSync(pairs, "utf8"));
const verdicts = fs.readdirSync(dir).filter(f => f.endsWith(".verdicts.json"))
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).verdicts);
const ids = new Set(items.map(i => i.id));
const seen = new Set();
for (const v of verdicts) {
  if (!ids.has(v.id)) throw new Error(`unknown id ${v.id}`);
  if (seen.has(v.id)) throw new Error(`duplicate verdict for ${v.id}`);
  if (!["A", "B", "tie"].includes(v.winner)) throw new Error(`bad winner for ${v.id}: ${v.winner}`);
  seen.add(v.id);
}
const missing = [...ids].filter(id => !seen.has(id));
if (missing.length) console.error(`missing ${missing.length}: ${missing.join(", ")}`);
const out = path.join(path.dirname(pairs), verdictsFile);
fs.writeFileSync(out, JSON.stringify({ judge, verdicts }, null, 2) + "\n");
console.log(`${verdicts.length}/${ids.size} verdicts → ${out}`);
' scripts/model-bench/results/<stem>.judge-pairs.json "$SCRATCH/bench-judge" claude-code/opus
```

`judge` is the label the report shows; name the model the subagents ran on. Re-run the affected slice's subagent for any id listed as missing, then merge again. A verdict still missing after that is reported as a judge error, not a tie, which is the honest outcome.

### 5. Import

```bash
pnpm bench:models --import-verdicts scripts/model-bench/results/<stem>.judge-verdicts.json
```

This rewrites `<stem>.md` and `<stem>.json` in place and echoes the summary. Now the other files may be read. Report the Judge table to the user and remind them that `<stem>.md` is the file to commit; the `.json` files beside it are gitignored.
