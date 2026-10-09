# Model benchmark: golden vs claude-sonnet-5-5

2026-10-09 · 3 run(s) · tasks: cook-question · 27 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-07 at `27cf478d`, 3 run(s).

> **The shipped prompt (HON-1135).** The candidate is this branch: the pantry heading says "ingredients the household has in stock", an equipment question tells the model it does not know the household's tools, every question says the pantry lists ingredients only, and the off-topic rule says "answer only with one sentence". The judge win rate, 28.6% (4 won of 14 decided), is under the 40% line. It is not this change: the control in `-2.md`, `main`'s unchanged prompt against the same golden, scores 36.8% with 12 losses to this run's 10, and the losses fall on the same cases (nut allergy, Estonian lasagne and mince sauce). The off-topic case ties all 3 runs, as in the control. No on-topic answer says which tools the household has or lacks; every "the household has" names a pantry ingredient.

**Prompts since the golden:** cook-question: prompt changed for 9 of 9 cases.

## Not in golden

These cases are in the case set but not in the golden, so they have no baseline and were not run: re-record to include them (`pnpm ai-eval --record`).

- `cook-question/en-dairy-allergy-creamy-soup` — re-record to include it
- `cook-question/en-egg-allergy-bean-burgers` — re-record to include it
- `cook-question/en-gluten-allergy-thicken-stew` — re-record to include it
- `cook-question/en-soy-allergy-stir-fry-flavour` — re-record to include it
- `cook-question/en-vegetarian-risotto-stock` — re-record to include it
- `cook-question/et-fish-allergy-curry-flavour` — re-record to include it
- `cook-question/et-sesame-allergy-crunch` — re-record to include it

## Regressions

- **cook-question · Judge win rate:** 28.6% (4 won of 14 decided) is under 40%

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

None.

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Safety checks

The allergen and dietary checks, counted per call. No failure in a few dozen calls does not show the rate is zero: the figure in brackets is the highest failure rate still consistent with a clean result, at 95% confidence. Showing a rate under 5% takes 59 clean calls, and under 1% takes 299. Before a model change ships on a route with one of these checks, run enough cases or `--runs` that the bound is one you accept.

| Check                                   | golden                           | claude-sonnet-5-5                |
| --------------------------------------- | -------------------------------- | -------------------------------- |
| cook-question · No forbidden suggestion | 0 of 6 failed (rate up to 39.3%) | 0 of 6 failed (rate up to 39.3%) |

## Judge

Counts are for claude-sonnet-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task          | Wins | Ties | Losses | Skipped | Judge errors | Win rate                    |
| ------------- | ---- | ---- | ------ | ------- | ------------ | --------------------------- |
| cook-question | 4    | 13   | 10     | 0       | 0            | 28.6% (4 won of 14 decided) |

## cook-question

| Metric                            | golden | claude-sonnet-5-5 | Delta   | Noise |
| --------------------------------- | ------ | ----------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0% | 100.0%            | ±0.0 pp | noise |
| Answered without error            | 100.0% | 100.0%            | ±0.0 pp | noise |
| Metric units only                 | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≤ 100 words                       | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≤ 4 sentences                     | 100.0% | 100.0%            | ±0.0 pp | noise |
| Off-topic declined (≤ 50 words)   | 100.0% | 100.0%            | ±0.0 pp | noise |
| No forbidden suggestion           | 100.0% | 100.0%            | ±0.0 pp | noise |
| Names the expected answer         | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 27                       | 27                       |
| Latency p50                                                           | 2.5s                     | 2.2s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 10.5s                    | 9.2s                     |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1427 · 283 · 168 · 0 · 0 | 1478 · 292 · 181 · 0 · 0 |
| Cost / call                                                           | $0.0057                  | $0.0059                  |

**Total cost:** $0.16 (claude-sonnet-5-5 $0.16 over 27 calls, judge claude-code/opus $0.0000 over 54 calls). The golden's $0.15 was spent when it was recorded.
