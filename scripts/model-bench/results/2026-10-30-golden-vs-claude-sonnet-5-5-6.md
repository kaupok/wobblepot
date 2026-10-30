# Model benchmark: golden vs claude-sonnet-5-5

2026-10-30 · 3 run(s) · tasks: imagine · 24 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-07 at `27cf478d`, 3 run(s).

**Prompts since the golden:** imagine: prompt changed for 8 of 8 cases.

## Not in golden

These cases are in the case set but not in the golden, so they have no baseline and were not run: re-record to include them (`pnpm ai-eval --record`).

- `imagine/en-dairy-allergy-mac-and-cheese` — re-record to include it
- `imagine/en-gluten-allergy-lasagne` — re-record to include it
- `imagine/en-sesame-allergy-poke-bowl` — re-record to include it
- `imagine/et-egg-allergy-pannkoogid` — re-record to include it
- `imagine/et-soy-allergy-wok` — re-record to include it

## Regressions

- **imagine · Judge win rate:** 30.0% (3 won of 10 decided) is under 40%

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

None.

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Safety checks

The allergen and dietary checks, counted per call. No failure in a few dozen calls does not show the rate is zero: the figure in brackets is the highest failure rate still consistent with a clean result, at 95% confidence. Showing a rate under 5% takes 59 clean calls, and under 1% takes 299. Before a model change ships on a route with one of these checks, run enough cases or `--runs` that the bound is one you accept.

| Check                             | golden                            | claude-sonnet-5-5                 |
| --------------------------------- | --------------------------------- | --------------------------------- |
| imagine · No forbidden ingredient | 0 of 24 failed (rate up to 11.7%) | 0 of 24 failed (rate up to 11.7%) |

## Judge

Counts are for claude-sonnet-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task    | Wins | Ties | Losses | Skipped | Judge errors | Win rate                    |
| ------- | ---- | ---- | ------ | ------- | ------------ | --------------------------- |
| imagine | 3    | 14   | 7      | 0       | 0            | 30.0% (3 won of 10 decided) |

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
| Latency p50                                                           | 18.8s                     | 18.5s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 23.2s                     | 23.5s                     |
| Calls over budget                                                     | 0                         | 0                         |
| Calls retried (latency includes retries)                              | 0                         | 0                         |
| Errors                                                                | none                      | none                      |
| Truncated (`finishReason: length`)                                    | 0                         | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3303 · 2617 · 780 · 0 · 0 | 3486 · 2657 · 797 · 0 · 0 |
| Cost / call                                                           | $0.0328                   | $0.0335                   |

**Total cost:** $0.80 (claude-sonnet-5-5 $0.80 over 24 calls, judge claude-code/opus $0.0000 over 48 calls). The golden's $0.79 was spent when it was recorded.
