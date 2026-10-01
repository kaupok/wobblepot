# AI models

Which Claude model each AI feature runs on, and how the AI eval (`pnpm ai-eval`) checks that a change to a model, a prompt or a budget is better, not only unbroken, before it ships.

Every model ID lives in `src/lib/ai/models.ts`, and every price in `MODEL_PRICES` in `src/lib/ai/pricing.ts`. Each route's AI time budget is in `src/lib/ai/budgets.ts`. The eval lives in `scripts/model-bench/`. Its old script name still works for one release and prints a deprecation line.

## Which run a change needs

The eval has three runs. Each writes a report to `scripts/model-bench/results/`, and the PR that makes the change commits it and cites it in its body. `scripts/pr-review.sh` asks for that report when the diff touches `models.ts`, `budgets.ts`, a request builder the eval imports or text it sends, or a committed case (HON-904).

| The PR changes                                                                                                                                                                                                                                | Run                                                               | Section                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| A model constant in `src/lib/ai/models.ts`                                                                                                                                                                                                    | A comparison, current model as baseline, new as candidate, judged | Compare → Two models            |
| A request builder (`prompts.ts`, `recipe-prompt.ts`, `imagine-request.ts`, `review-request.ts`, `preparation-tips.ts` in `src/lib/ai`), or text they send: an output schema (`recipe-schema.ts`, `types.ts`) or `src/lib/vague-quantities.ts` | `--baseline golden`, judged                                       | Compare → A prompt change       |
| A case under `scripts/model-bench/cases/`, or a budget in `budgets.ts`                                                                                                                                                                        | `--check`                                                         | Check the current configuration |

After a model promotion or an accepted prompt change merges, re-record the golden (Record the golden).

**Every run costs real money**, except `--dry-run`, which prints the call count and an estimate. A real run needs `ANTHROPIC_API_KEY` in `.env`. The eval never runs in CI.

## Check the current configuration

A comparison (below) says which of two models is better. `--check` asks the absolute question: does the configuration we ship pass? It runs one model per task against the same cases and scorers, holds each metric to a fixed gate, and exits 1 when any gate fails.

```bash
pnpm ai-eval --check --dry-run                        # what a bare check calls, and its cost
pnpm ai-eval --check                                  # each task on its constant in models.ts
pnpm ai-eval --check --model claude-sonnet-5-5        # every task on one model
```

Without `--model`, each task runs on its production constant: plan `PLANNING_MODEL`, recipe `RECIPE_MODEL`, imagine `IMAGINE_MODEL`, review `REVIEW_MODEL`, tips `TIPS_MODEL`. `--task`, `--runs`, `--max-usd` and `--dry-run` work as in a comparison. `--check` cannot be combined with `--baseline`, `--candidate`, `--judge` or `--judge-api`, and `--model` only goes with `--check`. Every model it would call needs a `MODEL_PRICES` entry, as in a comparison. A check costs about half a comparison: one model, one call per case and run.

A gate holds the metric's mean over all runs, with the run-to-run range shown beside it, to a threshold. The metric thresholds were set from the first live run (HON-859), with margin. The latency gate has no margin: it is the same 80% line the comparison uses.

| Task       | Metric                                                                                                     | Gate                        |
| ---------- | ---------------------------------------------------------------------------------------------------------- | --------------------------- |
| plan       | First-try valid, valid after repair, structure valid                                                       | 100%                        |
| plan       | Out-of-pool meal IDs                                                                                       | 0                           |
| recipe     | Ingredient recall, ingredient precision                                                                    | ≥ 95% (measured 98.8–99.4%) |
| recipe     | Quantity + unit exact, confidence tier agrees                                                              | 100%                        |
| imagine    | All checks pass, exactly 3 meals, servings = household size, ≥ 2 ingredients each, no forbidden ingredient | 100%                        |
| review     | Every ID exactly once                                                                                      | 100%                        |
| review     | Seeded errors corrected                                                                                    | ≥ 70% (measured 80%)        |
| review     | Correct quantities kept                                                                                    | ≥ 85% (measured 91.7–93.6%) |
| tips       | Item counts in range                                                                                       | 100%                        |
| every task | Max latency                                                                                                | ≤ 80% of the route budget   |

Distinct dinner proteins and the step-count delta have no gate. The gates live on the metric definitions (`gate` in `scripts/model-bench/tasks.ts`).

Gated offline on the HON-859 run's Sonnet 5.5 calls, today's production configuration passes every metric gate and fails one: imagine's max latency, 32.1s against the 32.0s line. Imagine sits close to its budget on both Sonnet 4.6 and 5.5 (HON-897), so expect a real `--check` to fail there until that is settled. That is the gate doing its job, not noise to tune away.

A metric that no case in the set measures, such as recipe recall when only the not-a-recipe case ran, passes as _not measured_. An errored call scores as a failure on the pass/fail checks, as in a comparison. A run that `--max-usd` stops early fails whatever its gates say, because the cases it never reached were not checked.

The report is `scripts/model-bench/results/<date>-check-<model, or "production">.md`, with the same `-2` rule and a gitignored `.json`. It opens with the result and a **Gates** table (task, gate, observed mean and range, threshold, pass or fail), which the run also echoes, followed by one metric table and one operational table per task. `--import-verdicts` refuses a check's files: a check has one model and nothing to judge.

### What it runs

It covers five AI calls: plan generation, recipe parsing (pasted text), imagine a meal (text only), the imagine quantity review, and preparation tips (full and supplementary). Each request comes from the same pure builder production calls, so the only difference from the app is the model ID. Out of scope: `fillEmptySlots`, image inputs, and the meal-image model and its judge.

Cases live in `scripts/model-bench/cases/<task>/*.json`, validated against the Zod schemas in `scripts/model-bench/case-schema.ts`. Every committed case is synthetic: one started from a production sample has had the user's text rewritten (see Where cases come from).

In a comparison, the two models run back to back on each case, and which one goes first alternates, so rate limits and drift through the day don't favour either. No abort signal is sent, so a call slower than its route budget still finishes and its real time is recorded.

### What it scores

Every check is deterministic. The optional judge, below, is the only place one model rates another.

- **plan:** structure valid; **first-try valid** (`validatePlan` before any repair, the number that matters); valid after `repairPlan`; out-of-pool meal IDs; distinct dinner proteins.
- **recipe:** ingredient recall and precision against the expected list; exact quantity and unit on matched ingredients; whether the confidence tier agrees with the case; the step-count difference (reported, never pass or fail). A not-a-recipe case sets `lowConfidence: true` and leaves `expected.ingredients` empty, since the app rejects the parse and there is nothing to recall. Only its confidence tier is scored: recall, precision and quantity match skip it, on an errored call too.
- **imagine:** exactly 3 meals, servings equal the household size, at least 2 ingredients each, no forbidden ingredient. The forbidden foods come from `src/lib/ai/forbidden-foods.ts`, the same lists the production guard in `imagineMeals` applies (HON-895): each allergen and dietary type maps to food groups with English and Estonian keywords, so a failure here on an allergen or diet means the guard failed too. A case's optional `forbiddenKeywords` add foods on top (its excluded ingredients, or a food the shared lists lack), excused only by the case's own `allowedQualifiers`. An ingredient is forbidden when its name contains a keyword that nothing in the same group excuses. A false friend ("nutmeg", "kalamata", "banaan" for "naan") excuses only the keyword inside it, so "coconut almond milk" still fails a nut allergy. A swap qualifier excuses more, as follows. A qualifier must start a word, and it excuses a keyword it contains ("eggplant" for "egg") or one that follows it after nothing but spaces ("vegan parmesan", "kaerahapukoor"). An excused keyword excuses the next one the same way, so "plant-based cream cheese" passes. Anything else is still a violation: "tofu bacon" does not excuse a plain "bacon" in another ingredient, "soy" does not excuse "honey soy sauce", and "coconut" does not excuse the butter in "coconut milk and butter". Qualifiers never cross groups: "almond" excuses the milk in "almond milk" for a dairy rule but not the almond for a nut allergy. A qualifier that is itself a food still has a blind spot: in the dairy group "almond" excuses "almond ricotta" whether or not the ricotta is plant-based, which no word rule can tell apart. So list a qualifier only when the swaps it names are worth that risk. The scorer checks ingredient names only; the guard also checks the meal name for allergens, so it is stricter, never looser. Sauces that hide an allergen ("satay", "pesto", "tzatziki") are matched in ingredient names only, even by the guard, because a safe adaptation keeps the dish name. An errored call fails every imagine check except this one: it served no food, so it has not broken a diet, and it is left out of this check's rate.
- **review:** every ingredient ID exactly once; each seeded error corrected into the case's range (the review prompt's own reference range where it gives one, otherwise ±25% of the expected value); each correct quantity left alone.
- **tips:** item counts within the ranges the prompt asks for.

Output that fails the schema is an error, not a score: `generateObject` throws on it. For each task and model the report also gives latency (p50 and max) against the route budget, calls over budget, calls the SDK retried, errors by name, truncations (`finishReason: length`), and mean tokens and cost per call. Latency is timed around `generateObject`, so it includes the SDK's retries (`maxRetries` is 2). A latency finding says when any call retried. Run files from before the count say "not recorded".

## Compare

### Two models

1. Add the new model to `MODEL_PRICES`. Keep the old entry: historical `AiUsage` rows still carry its ID, and a missing entry prices at $0.
2. Run a comparison with the current model as `--baseline` and the new one as `--candidate`, with `--judge`, then `/bench-judge` in Claude Code to fill in the judge's verdicts.
3. Commit the report it writes, and cite it in the upgrade PR, linked or pasted into the description.
4. Change the constants in `models.ts`.
5. Once the new constants are in production, record the golden (Record the golden). Prompt changes are compared with it from then on.

`/plan-issue` adds steps 2 and 3 to any plan that changes a constant in `models.ts`.

```bash
pnpm ai-eval --baseline <current-id> --candidate <new-id> --dry-run
pnpm ai-eval --baseline <current-id> --candidate <new-id>

# Past example: the Sonnet 5 → Sonnet 5.5 upgrade, now in `models.ts`
pnpm ai-eval --baseline claude-sonnet-5 --candidate claude-sonnet-5-5
```

### A prompt change

A comparison of two models sends both the same prompt: whatever the request builders in the working tree produce. To compare a prompt change, the other side has to be the old prompt's output, and the golden is that: a recorded `--check` run of the production configuration, committed in `scripts/model-bench/golden/<task>.json` (Record the golden).

```bash
pnpm ai-eval --baseline golden --candidate <current-id> --judge --dry-run
pnpm ai-eval --baseline golden --candidate <current-id> --judge
# then, in Claude Code:
/bench-judge
```

Commit the report and cite it in the PR. The baseline side is replayed from the golden, so only the candidate is called: half the cost of a comparison. The judge compares the new prompt's output with the recorded output blind, as it compares two models: nothing in the pairs file says which answers are the golden's. Every other part of the report reads as in a model comparison, with `golden` in the baseline column.

The report header says where the golden came from (`golden — <model> recorded <date> at <commit>`) and, per task, how many cases' prompt has changed since it was recorded (`imagine: prompt changed for 8 of 8 cases; plan: unchanged`). That line shows which tasks a prompt change reached. A task reading `unchanged` that the PR meant to change means the change never got into the request.

### Flags

| Flag          | Default                           | Meaning                                                                 |
| ------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `--baseline`  | required                          | The model in production today, or `golden` (see A prompt change)        |
| `--candidate` | required                          | The model you want to switch to                                         |
| `--task`      | `plan,recipe,imagine,review,tips` | Comma-separated subset of tasks                                         |
| `--runs`      | `3`                               | Times each case runs per model                                          |
| `--max-usd`   | `10`                              | Stop, and mark the report partial, once measured spend passes this      |
| `--dry-run`   | off                               | Print the call count and an estimated cost. No API calls, no key needed |
| `--judge`     | off                               | Also export imagine and tips pairs for judging in Claude Code (below)   |
| `--judge-api` | off                               | Judge those pairs with `claude-opus-5-5` through the API key instead    |

`pnpm ai-eval --import-verdicts <stem>.judge-verdicts.json` is the second half of `--judge`; see below.

A comparison bills both models for every case, every run, so start with `--dry-run`.

Either model ID without a `MODEL_PRICES` entry stops the run at startup, `--dry-run` included. An unpriced model would cost $0 per call, and `--max-usd` would never trip.

### Reading the report

The markdown report is written to `scripts/model-bench/results/<date>-<baseline>-vs-<candidate>.md`. Commit it, so the comparison history stays in the repo. A second run of the same pair on the same day gets a `-2` suffix rather than overwriting the first. A `.json` beside it holds every raw output and is gitignored.

Neither model accepts `temperature`, so the same case gives different output on each run. Each metric is shown as the mean across runs, with the min–max range in brackets.

**The noise flag.** A difference is **noise** when the gap between the two means is no larger than the wider of the two models' ranges. Such a difference says nothing either way, however large it looks. If an important metric is flagged noise, run again with more `--runs` rather than reading the delta. With `--runs 1`, or for a task a `--max-usd` stop reached only once, no range is measured at all, so every difference is listed as noise (marked `noise (1 run)`).

The report opens with three lists, and the run echoes them to the console:

- **Regressions:** a difference outside the noise range that crosses a threshold. Those are a first-try plan validity drop of more than 10 points, a recipe recall or precision drop of more than 5 points, or **any** drop in imagine's no-forbidden-ingredient rate. That last one is the dietary and allergen check, so it has no tolerance. Also listed is a task where the candidate's max latency is above 80% of the route budget while the baseline's is not, and the gap between the two maxes is larger than the spread of the baseline's per-run maxes. The candidate's own spread is not used, because it contains the slow call being judged. When the baseline is over the line too, the finding goes under "Other changes outside noise" with both values: the budget is the problem, not the model change. When the gap is inside the baseline's spread, it goes under "Within noise". It stays a regression with a single run on either side, since no range is measured. A candidate max over the full route budget, where the route would time out, is a regression whenever the baseline's is not, even if the baseline is over the 80% line.
- **Other changes outside noise:** every other difference outside the noise range, in either direction. A task where one model reports reasoning tokens and the other none is listed here too, with the per-call count: the benchmark sends no thinking configuration, so that is each model's default, and the task's latency and cost deltas include it. Most metrics have no threshold yet, since sizing one needs a live run's ranges, so a consistent drop on, say, review's seeded-error correction lands here rather than under Regressions. This list is what moved for real: read each change for the worse in it as a possible regression before calling a candidate safe. For most metrics that is a drop, but for plan's out-of-pool meal IDs it is a rise.
- **Within noise:** every difference flagged noise, including any that crossed a threshold. Noise beats thresholds, so these never count as regressions.

The `.json` beside the report carries the same three lists. With `--judge` or `--judge-api`, a **Judge** section follows them. Then comes one table per task, and the total cost. A **partial** report was stopped by `--max-usd` and is missing later runs and cases, or, if the API judge was stopped, later judged pairs.

## Record the golden

```bash
pnpm ai-eval --record --dry-run
pnpm ai-eval --record                  # then commit scripts/model-bench/golden/
pnpm ai-eval --record --task imagine   # re-record imagine.json only
```

`--record` is a `--check` (same flags, same report) that also writes one golden file per task it ran: the model, the date, the short commit, the run count, and for each case the sha256 of its prompt text and every call record, output included. A run that fails a gate writes nothing and exits 1, since the golden is what later changes are measured against; `--force` records it anyway, and the exit code still reports the failed gates. A run `--max-usd` stopped never records, with or without `--force`.

Record from a session that will not judge afterwards. A session that has read the golden's outputs knows which answers are the recorded ones, so it must not run `/bench-judge` on a comparison against them.

- **When to re-record:** after a model promotion (step 5 under Compare → Two models), and after merging a prompt change whose report you accepted, so the next prompt change is compared with what ships.
- **Cases added since recording** have no baseline. They are not run, and the report lists them under **Not in golden**: re-record to include them. A golden case that no longer exists is ignored. A selected task with no golden file stops the run with the `--record` command to fix it.
- **Runs.** `--record` needs at least 2 runs (the default is 3), and a comparison refuses a 1-run golden: with one run there is no run-to-run range, and every difference would read as noise. Without `--runs`, a comparison runs the candidate as many times as the golden was recorded; it may run fewer (at least 2 for a measured range), and then only that many of the golden's runs are compared, but never more, since a candidate run with no golden run beside it has nothing to be judged against. The noise rule uses each side's own range. If `--max-usd` stops the candidate, the baseline keeps only the cases and runs the candidate reached.
- **Scores are recomputed.** The golden's outputs are re-scored with today's scorers and case expectations, so a scorer change since recording does not read as a prompt change. If an output schema has changed so that a recorded output no longer scores, the run stops before calling anything and names the task to re-record. The total cost counts this run's calls only, and says what the golden cost to record.

## The judge (`--judge`, `--judge-api`)

The deterministic checks for imagine and tips mostly count items. They can't tell whether a meal sounds appetising, whether a tip is useful, or whether Estonian reads naturally. The judge adds a blind comparison for those two tasks: for every imagine and tips case, run by run, it sees the case input and the two models' answers labelled A and B, never a model name, and picks the better one. The rubric is `scripts/model-bench/judge-prompt.md`: fit to the household, then accuracy, then usefulness, then writing. For Estonian cases the judge also gets all of [AI_VOICE_ET.md](./AI_VOICE_ET.md). Plan, recipe and review are not judged: their deterministic scores already measure what matters.

There are two ways to run it. The prompts, the verdict rules and the summary are the same for both.

**`--judge` (the default): judged in Claude Code.** The run writes `<stem>.judge-pairs.json` beside the report, holding every judge prompt, and the report's Judge section says _Pending_. Then, in Claude Code, run `/bench-judge`: it answers the prompts with subagents, billed to the Claude Code subscription rather than the API key, and runs `pnpm ai-eval --import-verdicts <stem>.judge-verdicts.json`, which rewrites `<stem>.md` and `<stem>.json` in place with the Judge section filled in. No API cost; the report names the judge `claude-code/<model>`.

```bash
pnpm ai-eval --baseline <current-id> --candidate <new-id> --judge
# then, in Claude Code:
/bench-judge
```

Blindness survives the split because the pairs file holds only the A/B prompts. Which model sat as A is `judgeKey` in `<stem>.json`, and the judging session must not open that file, the `.md` or the case files before the import; `/bench-judge` reads only the pairs file. Both orders of every pair are exported, and the skill gives the two orders of a pair to different subagents, so position bias cancels the same way as below: a judge that saw both orders would only agree with itself, and the tie-on-disagreement rule would never fire. A `.judge-verdicts.json` is as gitignored as the rest; the judged `<stem>.md` is what gets committed.

**`--judge-api`: judged by `claude-opus-5-5`** (`JUDGE_MODEL` in `scripts/model-bench/judge.ts`) through the API key, straight after the benchmark. A pinned, reproducible judge, at a cost (end of this section). Use it when the report must not depend on a Claude Code session, or to cross-check a Claude Code verdict.

```bash
pnpm ai-eval --baseline <current-id> --candidate <new-id> --judge-api --dry-run
```

Each pair is judged **twice**, once with each model as A, to cancel any preference for a position. For the candidate:

- **Win:** both orders picked the candidate.
- **Loss:** both orders picked the baseline.
- **Tie:** the orders disagreed, or either said `tie`. A disagreement usually means the judge was following position, not quality.
- **Skipped:** either model's call errored, so there was nothing to compare. **Judge errors** are pairs where a judge call failed. Neither counts for or against the candidate.

The **win rate** is wins ÷ (wins + losses). Ties are left out of it and shown beside it, so many ties and a 50% win rate mean "no visible difference", not "worse". A win rate **under 40%** over **at least 5** decided pairs is listed under Regressions. With fewer than 5 decided pairs the table says "too few decided pairs" and nothing is flagged: run more `--runs` if the task matters. The noise rule doesn't apply to the judge. The `.json` report keeps both verdicts and both one-sentence reasons for every pair; read them before trusting a regression. Under `--judge`, a pair whose verdict is missing from the verdicts file counts as a judge error.

**`--judge-api` costs extra.** Two Opus calls per imagine and tips case per run, each sending the case, both answers, the rubric and, for Estonian cases, the voice reference. `--dry-run --judge-api` shows the judge calls as their own line and adds them to the total, and says when the estimate is above `--max-usd`. Judge calls count toward `--max-usd`, and with the full case set and 3 runs the estimate comes out above the default $10 cap, so raise the cap (`--max-usd 15`) when you pass `--judge-api`. The rubric, and for Estonian cases the voice reference, is sent as a cached system prompt, so each is billed in full once and as a cache read on every later call. The estimate counts it that way. It still errs high, since it sizes each answer by the benchmarked model's reasoning tokens, which the judge never sees. The limit is checked after each pair, so a stop never leaves a pair judged in only one order. `--dry-run --judge` shows the pair count instead, with no cost.

## Where cases come from

The case set grows from three sources, in this order of value:

1. **AI output bugs.** Every AI output bug that a scorer can express becomes a case, added in the PR that fixes it or before. The case reproduces the input that went wrong and carries the issue ID: `"source": "HON-895"`. It should fail on the configuration that had the bug, so the benchmark catches the bug if a later model or prompt brings it back. `/plan-issue` adds the case to the plan of any AI output bug. A bug no scorer can see, such as a tone problem, is the judge's to catch, so say so in the issue instead.
2. **Production samples.** `logAiSample` (`src/lib/ai/sampling.ts`) logs every Estonian AI call and 5% of English ones as an `[ai-sample]` line. `pnpm ai-eval --import-sample <file> --id <task>/<slug>` turns one line into `cases/<task>/<slug>.draft.json`, with the input fields the sample carried filled in and the expectation left empty. A draft is never loaded and is gitignored, because it holds a real household's words, allergens included. A human writes the expectation, rewrites the text as synthetic text with the same shape, and renames the file. Because the privacy policy keeps runtime logs for 1 day, the copied sample file is deleted once the draft exists, and a draft is finished or deleted the same day. `--import-sample` calls no model and cannot be combined with any other flag. `fill-empty-slots` samples are refused, as `fillEmptySlots` is out of scope.
3. **Synthetic cases** for coverage: a locale, a diet or a task variant no other case exercises. These have no `source`.

[`scripts/model-bench/cases/README.md`](../scripts/model-bench/cases/README.md) has a worked example of a good expectation for each task, the draft steps, and the `source` values. Adding a case changes what `--check` measures and leaves the golden without a baseline for it (listed under **Not in golden**), so re-record after adding one.
