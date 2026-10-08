# Model benchmark: claude-sonnet-5-5 vs claude-haiku-5-5

2026-10-08 · 5 run(s) · tasks: plan, recipe, imagine, review, tips, cook-question · 620 calls

## Regressions

- **imagine · Judge win rate:** 13.6% (8 won of 59 decided) is under 40%
- **tips · Judge win rate:** 18.8% (6 won of 32 decided) is under 40%
- **cook-question · Judge win rate:** 21.2% (14 won of 66 decided) is under 40%

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **recipe · Step count delta:** 0.25 (0.00–0.50) → -1.13 (-1.50–-0.88) (−1.38)
- **review · Correct quantities kept:** 93.3% (89.6%–94.8%) → 100.0% (+6.7 pp)
- **review · Reasoning:** the candidate reasons (171 tokens/call), the baseline does not; latency and cost deltas on this task include that
- **tips · Reasoning:** the candidate reasons (1051 tokens/call), the baseline does not; latency and cost deltas on this task include that

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **plan · Distinct dinner proteins:** 4.30 (4.13–4.38) → 4.38 (4.25–4.50) (+0.08)
- **recipe · Ingredient recall:** 98.9% (98.2%–100.0%) → 97.7% (96.7%–98.4%) (−1.2 pp)
- **recipe · Ingredient precision:** 98.9% (98.2%–100.0%) → 97.7% (96.7%–98.4%) (−1.2 pp)
- **review · Seeded errors corrected (±25%):** 80.0% → 82.0% (80.0%–90.0%) (+2.0 pp)
- **tips · Completed (no error, not cut off):** 100.0% → 97.5% (87.5%–100.0%) (−2.5 pp) — past the regression threshold, but inside the run-to-run range
- **tips · Answered without error:** 100.0% → 97.5% (87.5%–100.0%) (−2.5 pp)
- **tips · Item counts in range:** 100.0% → 97.5% (87.5%–100.0%) (−2.5 pp)

## Safety checks

The allergen and dietary checks, counted per call. No failure in a few dozen calls does not show the rate is zero: the figure in brackets is the highest failure rate still consistent with a clean result, at 95% confidence. Showing a rate under 5% takes 59 clean calls, and under 1% takes 299. Before a model change ships on a route with one of these checks, run enough cases or `--runs` that the bound is one you accept.

| Check                                   | claude-sonnet-5-5                | claude-haiku-5-5                 |
| --------------------------------------- | -------------------------------- | -------------------------------- |
| imagine · No forbidden ingredient       | 0 of 65 failed (rate up to 4.5%) | 0 of 65 failed (rate up to 4.5%) |
| cook-question · No forbidden suggestion | 0 of 40 failed (rate up to 7.2%) | 0 of 40 failed (rate up to 7.2%) |

## Judge

Counts are for claude-haiku-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task          | Wins | Ties | Losses | Skipped | Judge errors | Win rate                     |
| ------------- | ---- | ---- | ------ | ------- | ------------ | ---------------------------- |
| imagine       | 8    | 6    | 51     | 0       | 0            | 13.6% (8 won of 59 decided)  |
| tips          | 6    | 7    | 26     | 1       | 0            | 18.8% (6 won of 32 decided)  |
| cook-question | 14   | 14   | 52     | 0       | 0            | 21.2% (14 won of 66 decided) |

## plan

| Metric                            | claude-sonnet-5-5 | claude-haiku-5-5 | Delta   | Noise |
| --------------------------------- | ----------------- | ---------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0%            | 100.0%           | ±0.0 pp | noise |
| First-try valid                   | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Valid after repair                | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Structure valid                   | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Out-of-pool meal IDs              | 0.00              | 0.00             | ±0.00   | noise |
| Distinct dinner proteins          | 4.30 (4.13–4.38)  | 4.38 (4.25–4.50) | +0.08   | noise |

| Operational                                                           | claude-sonnet-5-5        | claude-haiku-5-5          |
| --------------------------------------------------------------------- | ------------------------ | ------------------------- |
| Calls                                                                 | 40                       | 40                        |
| Latency p50                                                           | 6.6s                     | 4.9s                      |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 12.6s                    | 8.9s                      |
| Calls over budget                                                     | 0                        | 0                         |
| Calls retried (latency includes retries)                              | 0                        | 0                         |
| Errors                                                                | none                     | none                      |
| Truncated (`finishReason: length`)                                    | 0                        | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2673 · 738 · 429 · 0 · 0 | 2673 · 1164 · 855 · 0 · 0 |
| Cost / call                                                           | $0.0127                  | $0.0008                   |

## recipe

| Metric                            | claude-sonnet-5-5    | claude-haiku-5-5    | Delta   | Noise         |
| --------------------------------- | -------------------- | ------------------- | ------- | ------------- |
| Completed (no error, not cut off) | 100.0%               | 100.0%              | ±0.0 pp | noise         |
| Ingredient recall                 | 98.9% (98.2%–100.0%) | 97.7% (96.7%–98.4%) | −1.2 pp | noise         |
| Ingredient precision              | 98.9% (98.2%–100.0%) | 97.7% (96.7%–98.4%) | −1.2 pp | noise         |
| Quantity + unit exact             | 100.0%               | 100.0%              | ±0.0 pp | noise         |
| Confidence tier agrees            | 100.0%               | 100.0%              | ±0.0 pp | noise         |
| Step count delta                  | 0.25 (0.00–0.50)     | -1.13 (-1.50–-0.88) | −1.38   | outside range |

| Operational                                                           | claude-sonnet-5-5      | claude-haiku-5-5          |
| --------------------------------------------------------------------- | ---------------------- | ------------------------- |
| Calls                                                                 | 45                     | 45                        |
| Latency p50                                                           | 6.2s                   | 7.2s                      |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 10.3s                  | 9.3s                      |
| Calls over budget                                                     | 0                      | 0                         |
| Calls retried (latency includes retries)                              | 0                      | 0                         |
| Errors                                                                | none                   | none                      |
| Truncated (`finishReason: length`)                                    | 0                      | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5504 · 711 · 8 · 0 · 0 | 5504 · 1556 · 850 · 0 · 0 |
| Cost / call                                                           | $0.0181                | $0.0013                   |

## imagine

| Metric                            | claude-sonnet-5-5 | claude-haiku-5-5 | Delta   | Noise |
| --------------------------------- | ----------------- | ---------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0%            | 100.0%           | ±0.0 pp | noise |
| All checks pass                   | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Exactly 3 meals                   | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Servings = household size         | 100.0%            | 100.0%           | ±0.0 pp | noise |
| ≥ 2 ingredients each              | 100.0%            | 100.0%           | ±0.0 pp | noise |
| No forbidden ingredient           | 100.0%            | 100.0%           | ±0.0 pp | noise |

| Operational                                                           | claude-sonnet-5-5         | claude-haiku-5-5           |
| --------------------------------------------------------------------- | ------------------------- | -------------------------- |
| Calls                                                                 | 65                        | 65                         |
| Latency p50                                                           | 22.4s                     | 13.5s                      |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 33.3s                     | 20.6s                      |
| Calls over budget                                                     | 0                         | 0                          |
| Calls retried (latency includes retries)                              | 0                         | 0                          |
| Errors                                                                | none                      | none                       |
| Truncated (`finishReason: length`)                                    | 0                         | 0                          |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3265 · 2745 · 871 · 0 · 0 | 3265 · 3121 · 1494 · 0 · 0 |
| Cost / call                                                           | $0.0340                   | $0.0019                    |

## review

| Metric                            | claude-sonnet-5-5   | claude-haiku-5-5    | Delta   | Noise         |
| --------------------------------- | ------------------- | ------------------- | ------- | ------------- |
| Completed (no error, not cut off) | 100.0%              | 100.0%              | ±0.0 pp | noise         |
| Every ID exactly once             | 100.0%              | 100.0%              | ±0.0 pp | noise         |
| Seeded errors corrected (±25%)    | 80.0%               | 82.0% (80.0%–90.0%) | +2.0 pp | noise         |
| Correct quantities kept           | 93.3% (89.6%–94.8%) | 100.0%              | +6.7 pp | outside range |

| Operational                                                           | claude-sonnet-5-5      | claude-haiku-5-5         |
| --------------------------------------------------------------------- | ---------------------- | ------------------------ |
| Calls                                                                 | 40                     | 40                       |
| Latency p50                                                           | 2.0s                   | 2.3s                     |
| Latency max (budget 45.0s, `REVIEW_AI_BUDGET_MS`)                     | 10.4s                  | 5.2s                     |
| Calls over budget                                                     | 0                      | 0                        |
| Calls retried (latency includes retries)                              | 0                      | 0                        |
| Errors                                                                | none                   | none                     |
| Truncated (`finishReason: length`)                                    | 0                      | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1257 · 173 · 0 · 0 · 0 | 1257 · 344 · 171 · 0 · 0 |
| Cost / call                                                           | $0.0042                | $0.0003                  |

## tips

| Metric                            | claude-sonnet-5-5 | claude-haiku-5-5     | Delta   | Noise |
| --------------------------------- | ----------------- | -------------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0%            | 97.5% (87.5%–100.0%) | −2.5 pp | noise |
| Answered without error            | 100.0%            | 97.5% (87.5%–100.0%) | −2.5 pp | noise |
| Item counts in range              | 100.0%            | 97.5% (87.5%–100.0%) | −2.5 pp | noise |

| Operational                                                           | claude-sonnet-5-5      | claude-haiku-5-5              |
| --------------------------------------------------------------------- | ---------------------- | ----------------------------- |
| Calls                                                                 | 40                     | 40                            |
| Latency p50                                                           | 4.9s                   | 8.0s                          |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 9.7s                   | 22.6s                         |
| Calls over budget                                                     | 0                      | 0                             |
| Calls retried (latency includes retries)                              | 0                      | 0                             |
| Errors                                                                | none                   | AI_NoObjectGeneratedError × 1 |
| Truncated (`finishReason: length`)                                    | 0                      | 1                             |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2181 · 402 · 0 · 0 · 0 | 2181 · 1395 · 1051 · 0 · 0    |
| Cost / call                                                           | $0.0084                | $0.0009                       |

## cook-question

| Metric                            | claude-sonnet-5-5 | claude-haiku-5-5 | Delta   | Noise |
| --------------------------------- | ----------------- | ---------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Answered without error            | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Metric units only                 | 100.0%            | 100.0%           | ±0.0 pp | noise |
| ≤ 100 words                       | 100.0%            | 100.0%           | ±0.0 pp | noise |
| ≤ 4 sentences                     | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Off-topic declined (≤ 50 words)   | 100.0%            | 100.0%           | ±0.0 pp | noise |
| No forbidden suggestion           | 100.0%            | 100.0%           | ±0.0 pp | noise |
| Names the expected answer         | 100.0%            | 100.0%           | ±0.0 pp | noise |

| Operational                                                           | claude-sonnet-5-5        | claude-haiku-5-5         |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 80                       | 80                       |
| Latency p50                                                           | 2.1s                     | 2.6s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 9.8s                     | 9.0s                     |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1383 · 234 · 125 · 0 · 0 | 1383 · 482 · 395 · 0 · 0 |
| Cost / call                                                           | $0.0051                  | $0.0004                  |

**Total cost:** $4.74 (claude-sonnet-5-5 $4.45, claude-haiku-5-5 $0.30 over 620 calls, judge claude-code/opus $0.0000 over 368 calls).
