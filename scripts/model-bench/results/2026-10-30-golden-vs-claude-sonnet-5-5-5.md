# Model benchmark: golden vs claude-sonnet-5-5

2026-10-30 · 3 run(s) · tasks: recipe, imagine · 54 calls

**Baseline:** golden — recipe `claude-sonnet-5-5` recorded 2026-10-28 at `3e4f1b50`, 3 run(s); imagine `claude-sonnet-5-5` recorded 2026-10-07 at `27cf478d`, 3 run(s).

**Prompts since the golden:** recipe: prompt changed for 10 of 10 cases; imagine: prompt changed for 8 of 8 cases.

## Not in golden

These cases are in the case set but not in the golden, so they have no baseline and were not run: re-record to include them (`pnpm ai-eval --record`).

- `imagine/en-dairy-allergy-mac-and-cheese` — re-record to include it
- `imagine/en-gluten-allergy-lasagne` — re-record to include it
- `imagine/en-sesame-allergy-poke-bowl` — re-record to include it
- `imagine/et-egg-allergy-pannkoogid` — re-record to include it
- `imagine/et-soy-allergy-wok` — re-record to include it

## Regressions

- **imagine · Judge win rate:** 29.4% (5 won of 17 decided) is under 40%

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **recipe · Reasoning:** the baseline reasons (20 tokens/call), the candidate does not; latency and cost deltas on this task include that

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **recipe · Quantity + unit exact:** 100.0% → 98.6% (97.2%–100.0%) (−1.4 pp)

## Safety checks

The allergen and dietary checks, counted per call. No failure in a few dozen calls does not show the rate is zero: the figure in brackets is the highest failure rate still consistent with a clean result, at 95% confidence. Showing a rate under 5% takes 59 clean calls, and under 1% takes 299. Before a model change ships on a route with one of these checks, run enough cases or `--runs` that the bound is one you accept.

| Check                             | golden                            | claude-sonnet-5-5                 |
| --------------------------------- | --------------------------------- | --------------------------------- |
| imagine · No forbidden ingredient | 0 of 24 failed (rate up to 11.7%) | 0 of 24 failed (rate up to 11.7%) |

## Judge

Counts are for claude-sonnet-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task    | Wins | Ties | Losses | Skipped | Judge errors | Win rate                    |
| ------- | ---- | ---- | ------ | ------- | ------------ | --------------------------- |
| imagine | 5    | 7    | 12     | 0       | 0            | 29.4% (5 won of 17 decided) |

## recipe

| Metric                            | golden | claude-sonnet-5-5    | Delta   | Noise |
| --------------------------------- | ------ | -------------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0% | 100.0%               | ±0.0 pp | noise |
| Ingredient recall                 | 100.0% | 100.0%               | ±0.0 pp | noise |
| Ingredient precision              | 100.0% | 100.0%               | ±0.0 pp | noise |
| Quantity + unit exact             | 100.0% | 98.6% (97.2%–100.0%) | −1.4 pp | noise |
| Confidence tier agrees            | 100.0% | 100.0%               | ±0.0 pp | noise |
| Step count delta                  | 0.44   | 0.44                 | ±0.00   | noise |
| Servings match                    | 100.0% | 100.0%               | ±0.0 pp | noise |

| Operational                                                           | golden                  | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ----------------------- | ---------------------- |
| Calls                                                                 | 30                      | 30                     |
| Latency p50                                                           | 4.8s                    | 4.9s                   |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 8.2s                    | 13.2s                  |
| Calls over budget                                                     | 0                       | 0                      |
| Calls retried (latency includes retries)                              | 0                       | 0                      |
| Errors                                                                | none                    | none                   |
| Truncated (`finishReason: length`)                                    | 0                       | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5451 · 709 · 20 · 0 · 0 | 6019 · 690 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0180                 | $0.0189                |

## imagine

| Metric                            | golden | claude-sonnet-5-5 | Delta   | Noise |
| --------------------------------- | ------ | ----------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0% | 100.0%            | ±0.0 pp | noise |
| All checks pass                   | 100.0% | 100.0%            | ±0.0 pp | noise |
| Exactly 3 meals                   | 100.0% | 100.0%            | ±0.0 pp | noise |
| Servings = household size         | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≥ 2 ingredients each              | 100.0% | 100.0%            | ±0.0 pp | noise |
| No forbidden ingredient           | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                    | claude-sonnet-5-5         |
| --------------------------------------------------------------------- | ------------------------- | ------------------------- |
| Calls                                                                 | 24                        | 24                        |
| Latency p50                                                           | 18.8s                     | 17.0s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 23.2s                     | 23.8s                     |
| Calls over budget                                                     | 0                         | 0                         |
| Calls retried (latency includes retries)                              | 0                         | 0                         |
| Errors                                                                | none                      | none                      |
| Truncated (`finishReason: length`)                                    | 0                         | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3303 · 2617 · 780 · 0 · 0 | 3486 · 2536 · 696 · 0 · 0 |
| Cost / call                                                           | $0.0328                   | $0.0323                   |

**Total cost:** $1.34 (claude-sonnet-5-5 $1.34 over 54 calls, judge claude-code/opus $0.0000 over 48 calls). The golden's $1.33 was spent when it was recorded.
