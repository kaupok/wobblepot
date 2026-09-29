# AI models

Which Claude model each AI feature runs on, and how to check that a new model is better, not only unbroken, before switching to it.

Every model ID lives in `src/lib/ai/models.ts`, and every price in `MODEL_PRICES` in `src/lib/ai/pricing.ts`. Each route's AI time budget is in `src/lib/ai/budgets.ts`.

## Changing a model

1. Add the new model to `MODEL_PRICES`. Keep the old entry: historical `AiUsage` rows still carry its ID, and a missing entry prices at $0.
2. Run the benchmark below with the current model as `--baseline` and the new one as `--candidate`.
3. Commit the report it writes, and attach it to the upgrade PR, linked or pasted into the description.
4. Change the constants in `models.ts`.

`/plan-issue` adds steps 2 and 3 to any plan that changes a constant in `models.ts`.

## The benchmark

```bash
pnpm bench:models --baseline claude-sonnet-5 --candidate claude-sonnet-5-5 --dry-run
pnpm bench:models --baseline claude-sonnet-5 --candidate claude-sonnet-5-5
```

| Flag          | Default                           | Meaning                                                                 |
| ------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `--baseline`  | required                          | The model in production today                                           |
| `--candidate` | required                          | The model you want to switch to                                         |
| `--task`      | `plan,recipe,imagine,review,tips` | Comma-separated subset of tasks                                         |
| `--runs`      | `3`                               | Times each case runs per model                                          |
| `--max-usd`   | `10`                              | Stop, and mark the report partial, once measured spend passes this      |
| `--dry-run`   | off                               | Print the call count and an estimated cost. No API calls, no key needed |

**It costs real money.** A full run bills both models for every case, every run. Start with `--dry-run` to see the call count and a rough estimate. A real run needs `ANTHROPIC_API_KEY` in `.env`. The benchmark never runs in CI.

Either model ID without a `MODEL_PRICES` entry stops the run at startup, `--dry-run` included. An unpriced model would cost $0 per call, and `--max-usd` would never trip.

### What it runs

It covers five AI calls: plan generation, recipe parsing (pasted text), imagine a meal (text only), the imagine quantity review, and preparation tips (full and supplementary). Each request comes from the same pure builder production calls, so the only difference from the app is the model ID. Out of scope: `fillEmptySlots`, image inputs, and the meal-image model and its judge.

Cases live in `scripts/model-bench/cases/<task>/*.json`, validated against the Zod schemas in `scripts/model-bench/case-schema.ts`. They are all synthetic. Never copy one from `.ai-samples/`, which holds real users' text.

The two models run back to back on each case, and which one goes first alternates, so rate limits and drift through the day don't favour either. No abort signal is sent, so a call slower than its route budget still finishes and its real time is recorded.

### What it scores

Every check is deterministic, with no model judging another:

- **plan:** structure valid; **first-try valid** (`validatePlan` before any repair, the number that matters); valid after `repairPlan`; out-of-pool meal IDs; distinct dinner proteins.
- **recipe:** ingredient recall and precision against the expected list; exact quantity and unit on matched ingredients; whether the confidence tier agrees with the case; the step-count difference (reported, never pass or fail).
- **imagine:** exactly 3 meals, servings equal the household size, at least 2 ingredients each, no forbidden ingredient.
- **review:** every ingredient ID exactly once; each seeded error corrected to within 25%; each correct quantity left alone.
- **tips:** item counts within the ranges the prompt asks for.

Output that fails the schema is an error, not a score: `generateObject` throws on it. For each task and model the report also gives latency (p50 and max) against the route budget, calls over budget, errors by name, truncations (`finishReason: length`), and mean tokens and cost per call.

### Reading the report

The markdown report is written to `scripts/model-bench/results/<date>-<baseline>-vs-<candidate>.md`. Commit it, so the comparison history stays in the repo. A `.json` beside it holds every raw output and is gitignored.

Neither model accepts `temperature`, so the same case gives different output on each run. Each metric is shown as the mean across runs, with the min–max range in brackets.

**The noise flag.** A difference is **noise** when the gap between the two means is no larger than the wider of the two models' ranges. Such a difference says nothing either way, however large it looks. If an important metric is flagged noise, run again with more `--runs` rather than reading the delta.

The report opens with two lists:

- **Regressions:** a difference outside the noise range that crosses a threshold. Those are a first-try plan validity drop of more than 10 points, or a recipe recall or precision drop of more than 5 points. Also listed is any task where the candidate's max latency is above 80% of the route budget. That rule compares against the budget, not the baseline, so noise does not apply.
- **Within noise:** every difference flagged noise, including any that crossed a threshold. Noise beats thresholds, so these never count as regressions.

Then comes one table per task, and the total cost. A **partial** report was stopped by `--max-usd` and is missing later runs and cases.
