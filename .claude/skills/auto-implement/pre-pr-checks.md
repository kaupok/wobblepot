# Auto-implement — pre-PR checks (4.3)

The PR reviewer (`scripts/pr-review.sh`) checks these four rules on every round. 4.3 runs its prompt on the local changes, and you check the rules yourself, before the PR opens, because each miss the reviewer finds costs one more review round (`history.md` → Pre-PR checks, Local review in 4.3).

## Local review

`./scripts/pr-review.sh --local <ID>` reviews the working tree against the merge base with origin/main, untracked files included, so run it before Phase 5 commits. It writes the summary to `/tmp/auto-implement-local-review-<ID>.md`, with no inline comments: every finding is in its `**Issues found:**` list or under `**Spec:**`. It leaves out the PR-body and driven-screen checks, so item 3 below and the 4.3 Driven screens step stay yours.

Run it once per cycle. Do not re-run it after the 4.5 fixes: the PR review in 6.3 checks them.

A large diff can outrun the 600 s cap, as 6.3 notes. Past 600 s, background it and wait in this turn for the findings file, as `batched.md` does; a slow review does not get faster on a retry. A non-zero exit leaves no file: run it once more, unless the first run hit the cap. A second failure, or a wait that ends with no file → print `[auto-implement] Local review failed; continuing — the 6.3 PR review still gates the merge` and go on with the other 4.3 items.

Each item names the source of its rule. Read the rule there, not here: a copy drifts from the reviewer prompt. `scripts/review-checklist-gate.test.ts` fails when a phrase quoted here leaves its source.

## 1. AI eval report

Source: `.claude/skills/plan-issue/ai-eval.md` → **Prompt, budget and case changes:** and **Model changes:**. The reviewer's side: `scripts/pr-review.sh` → `AI_EVAL_PROMPT` → "Also check for an AI eval report".

The trigger is the reviewer's: run this item when the diff touches a file that the `AI_EVAL_FILES` grep in `scripts/pr-review.sh` matches. The `ai-eval.md` list can lag that grep, so do not use it as the trigger.

- The diff changes a request builder or text the eval sends → run `pnpm ai-eval --baseline golden --candidate <current-id> --judge`, then `/bench-judge`.
- The diff changes a model constant in `src/lib/ai/models.ts` → run the comparison that **Model changes:** names.
- The diff changes `budgets.ts` or a committed case → run `pnpm ai-eval --check`.

Commit the report and cite it in the PR body. A run past 600 s: `batched.md`.

## 2. Tests can go red

Source: `scripts/pr-review.sh` → `TEST_PROMPT` → **Unable to go red**.

For each new or changed test, revert the lines of the implementation it covers, run only that test, and see it fail. Then restore the lines. Do not use `git stash`: the stash is shared with other worktrees. A test that still passes asserts nothing about the change, so assert the specific value the change produces.

## 3. PR body proof

Source: `scripts/pr-review.sh` → `PR_BODY_PROMPT` → "Also check the PR body's Verified / Not verified lists".

Apply it in 5.4, when you write the body. The reviewer reports a "Verified" line that names no command, test, story or spec. So each "Verified" line names the command, test, story or spec you ran, and its result.

## 4. Plan deviations

Source: `scripts/pr-review.sh` → `SPEC_PROMPT` → **Not asked for**: "A change the plan's Design Decisions choose, with a reason, is asked for".

Compare the diff with the plan comment from 2.8. The diff adds behaviour that the plan does not name → add a Design Decisions row with the reason to that comment (`save_comment` with its `id`), before 5.4. Behaviour you cannot give a reason for comes out of the diff.
