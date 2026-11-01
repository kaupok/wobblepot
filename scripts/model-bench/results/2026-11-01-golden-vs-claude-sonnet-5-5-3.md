# Model benchmark: golden vs claude-sonnet-5-5

2026-11-01 · 3 run(s) · tasks: recipe, imagine · 69 calls

**Baseline:** golden — recipe `claude-sonnet-5-5` recorded 2026-11-01 at `54e50b48`, 3 run(s); imagine `claude-sonnet-5-5` recorded 2026-10-30 at `421184b6`, 3 run(s).

**Prompts since the golden:** recipe: prompt changed for 10 of 10 cases; imagine: prompt changed for 13 of 13 cases.

## Regressions

- **imagine · Judge win rate:** 31.6% (6 won of 19 decided) is under 40%

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **recipe · Ingredient recall:** 98.8% → 100.0% (+1.2 pp)
- **recipe · Ingredient precision:** 98.8% → 100.0% (+1.2 pp)

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Safety checks

The allergen and dietary checks, counted per call. No failure in a few dozen calls does not show the rate is zero: the figure in brackets is the highest failure rate still consistent with a clean result, at 95% confidence. Showing a rate under 5% takes 59 clean calls, and under 1% takes 299. Before a model change ships on a route with one of these checks, run enough cases or `--runs` that the bound is one you accept.

| Check                             | golden                           | claude-sonnet-5-5                |
| --------------------------------- | -------------------------------- | -------------------------------- |
| imagine · No forbidden ingredient | 0 of 39 failed (rate up to 7.4%) | 0 of 39 failed (rate up to 7.4%) |

## Judge

Counts are for claude-sonnet-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task    | Wins | Ties | Losses | Skipped | Judge errors | Win rate                    |
| ------- | ---- | ---- | ------ | ------- | ------------ | --------------------------- |
| imagine | 6    | 20   | 13     | 0       | 0            | 31.6% (6 won of 19 decided) |

## recipe

| Metric                            | golden | claude-sonnet-5-5 | Delta   | Noise         |
| --------------------------------- | ------ | ----------------- | ------- | ------------- |
| Completed (no error, not cut off) | 100.0% | 100.0%            | ±0.0 pp | noise         |
| Ingredient recall                 | 98.8%  | 100.0%            | +1.2 pp | outside range |
| Ingredient precision              | 98.8%  | 100.0%            | +1.2 pp | outside range |
| Quantity + unit exact             | 100.0% | 100.0%            | ±0.0 pp | noise         |
| Confidence tier agrees            | 100.0% | 100.0%            | ±0.0 pp | noise         |
| Step count delta                  | 0.44   | 0.44              | ±0.00   | noise         |
| Servings match                    | 100.0% | 100.0%            | ±0.0 pp | noise         |

| Operational                                                           | golden                  | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- | ----------------------- |
| Calls                                                                 | 30                      | 30                      |
| Latency p50                                                           | 4.5s                    | 4.5s                    |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 8.4s                    | 23.0s                   |
| Calls over budget                                                     | 0                       | 0                       |
| Calls retried (latency includes retries)                              | 0                       | 0                       |
| Errors                                                                | none                    | none                    |
| Truncated (`finishReason: length`)                                    | 0                       | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 6332 · 738 · 47 · 0 · 0 | 6414 · 728 · 38 · 0 · 0 |
| Cost / call                                                           | $0.0200                 | $0.0201                 |

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
| Calls                                                                 | 39                        | 39                        |
| Latency p50                                                           | 18.3s                     | 18.1s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 26.4s                     | 22.1s                     |
| Calls over budget                                                     | 0                         | 0                         |
| Calls retried (latency includes retries)                              | 0                         | 0                         |
| Errors                                                                | none                      | none                      |
| Truncated (`finishReason: length`)                                    | 0                         | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3448 · 2754 · 895 · 0 · 0 | 3502 · 2703 · 872 · 0 · 0 |
| Cost / call                                                           | $0.0344                   | $0.0340                   |

**Total cost:** $1.93 (claude-sonnet-5-5 $1.93 over 69 calls, judge claude-code/opus $0.0000 over 78 calls). The golden's $1.94 was spent when it was recorded.
