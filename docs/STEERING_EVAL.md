# Steering eval

`scripts/steering-eval.sh` tests whether agents still need a steering rule, the text in `CLAUDE.md`, `.claude/rules/`, a skill or a doc that tells an agent what to do (HON-1345). Each rule costs every reader context. The eval measures the benefit: does an agent break the rule when the rule is not there?

It is not a CI job. One rule costs 9 to 18 sessions. Run it by hand, or after a model swap ([PARALLEL_WORKFLOW.md → Swapping models](PARALLEL_WORKFLOW.md#swapping-models)).

## Run it

```bash
scripts/steering-eval.sh validate-once            # a rule in scripts/steering-eval/
scripts/steering-eval.sh validate-once --n 5      # 5 runs per arm and model, not 3
scripts/steering-eval.sh validate-once --model claude-fable-5-1   # one model only, to re-run an error row
```

For each of the three models that read the steering files, the script does this:

1. **Control.** It runs N blind sessions at once with the rule text removed.
2. **Treatment.** It runs only when a control run failed. It runs N more sessions with the rule kept.

The three models are `AUTO_MODEL` at `AUTO_EFFORT` (unattended workers), `AUTO_MODEL_SMALL` at `AUTO_EFFORT_SMALL` (Small-tier workers) and `INTERACTIVE_MODEL` (interactive sessions). They come from `scripts/models.sh`, and the `CLAUDE_*` env vars override them as they do for the workflow.

An arm takes the wall time of its slowest run: 2 to 12 minutes on Opus and Sonnet, up to 35 on Fable.

Each run writes its results under `/tmp/steering-eval/<rule>-<time>/<model>/<arm>-<i>/`. Its tree is a `mktemp -d` directory, named in that run's `tree` file, because the agent sees its working directory and a path under the results directory names the rule and the arm:

- The tree is a `git archive` of `HEAD` with one "Initial commit". The control tree has the rule text removed before that commit, so `git log` and `git diff` cannot show the rule.
- The eval's own files are removed from the tree, because they quote the rule and name the experiment.
- The tree is a `git worktree` with no remote, so the main-checkout hook allows edits and nothing can be pushed.
- `node_modules` is a symlink to this checkout's.
- `claude -p` runs with `--strict-mcp-config` and no MCP server, so a run cannot reach Linear or GitHub. It writes `--output-format stream-json` to `stream.jsonl`.
- The prompt names only the task. The agent is not told that it is tested.
- A run that printed its `result` event counts as finished, even when its process outlived the bound on a child it started.
- After the run, the script writes `diff.patch` (everything since the initial commit) and runs the rule's check on it.

Env: `STEERING_EVAL_N` (3), `STEERING_EVAL_TIMEOUT` (3600 seconds per run; a Fable run can take 35 minutes), `STEERING_EVAL_REF` (`HEAD`), `STEERING_EVAL_OUT` (`/tmp/steering-eval`), and `STEERING_EVAL_KEEP=1` to keep the run trees for a look (each run's `tree` file names its tree).

## Read the table

```
| Rule | Model | Control pass | Treatment pass | Verdict |
| -- | -- | -- | -- | -- |
| validate-once | claude-opus-5-5 | 3/3 | not run | dead: control passes |
| validate-once | claude-sonnet-5-5 (low) | 1/3 | 3/3 | live |
| validate-once | claude-fable-5-1 | 1/3 | 1/3 | dead: both arms fail |
```

- A cell is the number of runs that passed the check. An `error` is a timeout, a non-zero `claude` exit, an empty diff or a check that printed neither `PASS` nor `FAIL`. An error counts as neither a pass nor a fail, because silence is not evidence.
- **`dead: control passes`**: every control run passed. The model does what the rule asks without it.
- **`live`**: a control run failed, and more treatment runs than control runs passed. The rule changes what the agent does.
- **`dead: both arms fail`**: a control run failed, and the rule did not raise the pass count. The rule does not work as written.
- **`error`**: there is not enough evidence. Either a control run errored and none failed, or treatment errored without a clear win. Re-run it once.

A rule is dead only when it is dead on all three models. A rule that Opus no longer needs can still matter to Sonnet at low effort.

**What `dead` means.** With N=3 per model, a rule that the model breaks one run in ten passes all nine control runs 39% of the time. So `dead` means "not broken often", not "never needed". The script prints this sentence for the N it ran. That is acceptable for a rule of 15 to 45 words, because `/retro` re-adds a rule after an incident. Run a larger N on a longer rule.

**What to do with a verdict:**

- **`live`**: the rule stays. Add "verified live on <models>, YYYY-MM-DD" to the rule's entry in `docs/AGENT_HISTORY.md` (or the skill's `history.md`).
- **`dead: control passes`**: file an issue to remove the text.
- **`dead: both arms fail`**: file an issue to replace the text with a check (lint, test, hook). A mechanical mistake gets a check, not a sentence.

## Add a rule

A rule needs a mechanical check. A rule with no check (chat behaviour, for example) stays untested and stays in.

1. Write `scripts/steering-eval/<rule-id>.json`:

   ```json
   {
     "id": "validate-once",
     "summary": "Where the rule lives, in a few words",
     "remove": [{ "file": ".claude/rules/code.md", "text": "- Validate input once, …\n" }],
     "prompt": "A small task in src/ that would trip the rule. Leave the change uncommitted.",
     "check": "pnpm exec tsx scripts/steering-eval/checks.ts validate-once"
   }
   ```

   - `remove` lists every copy of the rule. The control tree loses each `text` from its `file`, and the run fails to prepare when a text is no longer there.
   - `prompt` names the task only. Do not use the words test, eval, rule or steering, and do not name CLAUDE.md.
   - `check` runs from this checkout with three arguments: the run's worktree, its `stream.jsonl` and its `diff.patch`. Its last line on stdout is `PASS` or `FAIL`; put the reasons on stderr. A check on tool calls reads `stream.jsonl`.

2. Add the check to `scripts/steering-eval/checks.ts`, or write any command that follows the contract.
3. Add `scripts/steering-eval/fixtures/<rule-id>.good.patch` and `.bad.patch`.
4. Add the rule ID to `GROUP_1` in `scripts/steering-eval.test.ts`, or to a new group list there.
5. Run `pnpm vitest run scripts/steering-eval.test.ts`. The tests check four things:
   - each `remove` text is in its file and in no other tracked file
   - the control tree lacks the text, and the treatment tree has it
   - the prompt does not give the experiment away
   - the check passes the good fixture and fails the bad one
