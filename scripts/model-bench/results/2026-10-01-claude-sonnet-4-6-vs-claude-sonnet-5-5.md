# Model benchmark: claude-sonnet-4-6 vs claude-sonnet-5-5

2026-10-01 · 3 run(s) · tasks: plan, recipe, imagine, review, tips · 246 calls

## Regressions

- **imagine · Max latency:** the candidate's 32.1s is above 80% of the 40.0s route budget (IMAGINE_AI_BUDGET_MS)

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **plan · Distinct dinner proteins:** 4.04 (4.00–4.13) → 4.42 (4.38–4.50) (+0.38)
- **imagine · All checks pass:** 66.7% (62.5%–75.0%) → 100.0% (+33.3 pp)
- **imagine · No forbidden ingredient:** 66.7% (62.5%–75.0%) → 100.0% (+33.3 pp)

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **recipe · Ingredient recall:** 99.4% (98.2%–100.0%) → 98.8% (98.2%–100.0%) (−0.6 pp)
- **recipe · Ingredient precision:** 99.4% (98.2%–100.0%) → 98.8% (98.2%–100.0%) (−0.6 pp)
- **review · Correct quantities kept:** 91.7% → 93.6% (91.2%–94.8%) (+1.9 pp)

## Judge

Counts are for claude-sonnet-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task    | Wins | Ties | Losses | Skipped | Judge errors | Win rate                     |
| ------- | ---- | ---- | ------ | ------- | ------------ | ---------------------------- |
| imagine | 19   | 1    | 4      | 0       | 0            | 82.6% (19 won of 23 decided) |
| tips    | 19   | 1    | 4      | 0       | 0            | 82.6% (19 won of 23 decided) |

## plan

| Metric                   | claude-sonnet-4-6 | claude-sonnet-5-5 | Delta   | Noise         |
| ------------------------ | ----------------- | ----------------- | ------- | ------------- |
| First-try valid          | 100.0%            | 100.0%            | ±0.0 pp | noise         |
| Valid after repair       | 100.0%            | 100.0%            | ±0.0 pp | noise         |
| Structure valid          | 100.0%            | 100.0%            | ±0.0 pp | noise         |
| Out-of-pool meal IDs     | 0.00              | 0.00              | ±0.00   | noise         |
| Distinct dinner proteins | 4.04 (4.00–4.13)  | 4.42 (4.38–4.50)  | +0.38   | outside range |

| Operational                                                           | claude-sonnet-4-6      | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ---------------------- | ------------------------ |
| Calls                                                                 | 24                     | 24                       |
| Latency p50                                                           | 3.2s                   | 5.8s                     |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 7.8s                   | 10.7s                    |
| Calls over budget                                                     | 0                      | 0                        |
| Errors                                                                | none                   | none                     |
| Truncated (`finishReason: length`)                                    | 0                      | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2028 · 235 · 0 · 0 · 0 | 2664 · 785 · 476 · 0 · 0 |
| Cost / call                                                           | $0.0096                | $0.0132                  |

## recipe

| Metric                 | claude-sonnet-4-6    | claude-sonnet-5-5    | Delta   | Noise |
| ---------------------- | -------------------- | -------------------- | ------- | ----- |
| Ingredient recall      | 99.4% (98.2%–100.0%) | 98.8% (98.2%–100.0%) | −0.6 pp | noise |
| Ingredient precision   | 99.4% (98.2%–100.0%) | 98.8% (98.2%–100.0%) | −0.6 pp | noise |
| Quantity + unit exact  | 100.0%               | 100.0%               | ±0.0 pp | noise |
| Confidence tier agrees | 100.0%               | 100.0%               | ±0.0 pp | noise |
| Step count delta       | 0.50                 | 0.50                 | ±0.00   | noise |

| Operational                                                           | claude-sonnet-4-6      | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Calls                                                                 | 27                     | 27                     |
| Latency p50                                                           | 9.3s                   | 5.0s                   |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 13.2s                  | 7.6s                   |
| Calls over budget                                                     | 0                      | 0                      |
| Errors                                                                | none                   | none                   |
| Truncated (`finishReason: length`)                                    | 0                      | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3940 · 515 · 0 · 0 · 0 | 5259 · 711 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0195                | $0.0176                |

## imagine

| Metric                    | claude-sonnet-4-6   | claude-sonnet-5-5 | Delta    | Noise         |
| ------------------------- | ------------------- | ----------------- | -------- | ------------- |
| All checks pass           | 66.7% (62.5%–75.0%) | 100.0%            | +33.3 pp | outside range |
| Exactly 3 meals           | 100.0%              | 100.0%            | ±0.0 pp  | noise         |
| Servings = household size | 100.0%              | 100.0%            | ±0.0 pp  | noise         |
| ≥ 2 ingredients each      | 100.0%              | 100.0%            | ±0.0 pp  | noise         |
| No forbidden ingredient   | 66.7% (62.5%–75.0%) | 100.0%            | +33.3 pp | outside range |

| Operational                                                           | claude-sonnet-4-6       | claude-sonnet-5-5          |
| --------------------------------------------------------------------- | ----------------------- | -------------------------- |
| Calls                                                                 | 24                      | 24                         |
| Latency p50                                                           | 23.1s                   | 22.9s                      |
| Latency max (budget 40.0s, `IMAGINE_AI_BUDGET_MS`)                    | 30.7s                   | 32.1s                      |
| Calls over budget                                                     | 0                       | 0                          |
| Errors                                                                | none                    | none                       |
| Truncated (`finishReason: length`)                                    | 0                       | 0                          |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2377 · 1714 · 0 · 0 · 0 | 3079 · 3574 · 1042 · 0 · 0 |
| Cost / call                                                           | $0.0328                 | $0.0419                    |

## review

| Metric                         | claude-sonnet-4-6 | claude-sonnet-5-5   | Delta   | Noise |
| ------------------------------ | ----------------- | ------------------- | ------- | ----- |
| Every ID exactly once          | 100.0%            | 100.0%              | ±0.0 pp | noise |
| Seeded errors corrected (±25%) | 80.0%             | 80.0%               | ±0.0 pp | noise |
| Correct quantities kept        | 91.7%             | 93.6% (91.2%–94.8%) | +1.9 pp | noise |

| Operational                                                           | claude-sonnet-4-6     | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | --------------------- | ---------------------- |
| Calls                                                                 | 24                    | 24                     |
| Latency p50                                                           | 2.2s                  | 1.9s                   |
| Latency max (budget 45.0s, `REVIEW_AI_BUDGET_MS`)                     | 3.7s                  | 3.2s                   |
| Calls over budget                                                     | 0                     | 0                      |
| Errors                                                                | none                  | none                   |
| Truncated (`finishReason: length`)                                    | 0                     | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 944 · 120 · 0 · 0 · 0 | 1257 · 174 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0046               | $0.0042                |

## tips

| Metric               | claude-sonnet-4-6 | claude-sonnet-5-5 | Delta   | Noise |
| -------------------- | ----------------- | ----------------- | ------- | ----- |
| Item counts in range | 100.0%            | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | claude-sonnet-4-6     | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | --------------------- | ---------------------- |
| Calls                                                                 | 24                    | 24                     |
| Latency p50                                                           | 9.1s                  | 5.0s                   |
| Latency max (budget 45.0s, `TIPS_AI_BUDGET_MS`)                       | 16.7s                 | 10.2s                  |
| Calls over budget                                                     | 0                     | 0                      |
| Errors                                                                | none                  | none                   |
| Truncated (`finishReason: length`)                                    | 0                     | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 982 · 345 · 0 · 0 · 0 | 1293 · 484 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0081               | $0.0074                |

**Total cost:** $3.93 (claude-sonnet-4-6 $1.85, claude-sonnet-5-5 $2.08 over 246 calls, judge claude-code/opus $0.0000 over 96 calls).
