# Model benchmark: golden vs claude-sonnet-5-5

2026-10-07 · 3 run(s) · tasks: plan, recipe, imagine, review, tips, cook-question · 150 calls

**Baseline:** golden — plan `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s); recipe `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s); imagine `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s); review `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s); tips `claude-sonnet-5-5` recorded 2026-10-02 at `c5eaa840`, 3 run(s); cook-question `claude-sonnet-5-5` recorded 2026-10-05 at `3d4afd93`, 3 run(s).

> **The shipped prompt (HON-1098).** The candidate is the final branch of PR #1174: the British English block (`britishEnglish` in `src/lib/ai/prompts.ts`) on the imagine, recipe, tips and cook-question requests, with the review request back to the golden's. It supersedes `2026-10-07-golden-vs-claude-sonnet-5-5.md`, which ran before review feedback removed the block from the review request and added "sweet pepper" for a pepper of unknown colour. No regressions. In the English outputs, the American words the block names (zucchini, cilantro, shrimp, ground beef, skillet, stovetop, heavy cream and the rest) fall from 40 in the golden to 3 here, all three in `originalText`, the verbatim source line "1 lb ground beef".

**Prompts since the golden:** plan: unchanged; recipe: prompt changed for 9 of 9 cases; imagine: prompt changed for 8 of 8 cases; review: unchanged; tips: prompt changed for 6 of 8 cases; cook-question: prompt changed for 6 of 9 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **review · Reasoning:** the candidate reasons (57 tokens/call), the baseline does not; latency and cost deltas on this task include that

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **plan · Distinct dinner proteins:** 4.25 (4.13–4.38) → 4.33 (4.25–4.38) (+0.08)
- **recipe · Step count delta:** 0.38 (0.13–0.50) → 0.08 (0.00–0.13) (−0.29)
- **review · Correct quantities kept:** 93.8% (88.5%–97.9%) → 96.9% (94.8%–97.9%) (+3.1 pp)

## Judge

Counts are for claude-sonnet-5-5. claude-opus-5-5 compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task    | Wins | Ties | Losses | Skipped | Judge errors | Win rate                     |
| ------- | ---- | ---- | ------ | ------- | ------------ | ---------------------------- |
| imagine | 7    | 8    | 9      | 0       | 0            | 43.8% (7 won of 16 decided)  |
| tips    | 11   | 2    | 11     | 0       | 0            | 50.0% (11 won of 22 decided) |

## plan

| Metric                   | golden           | claude-sonnet-5-5 | Delta   | Noise |
| ------------------------ | ---------------- | ----------------- | ------- | ----- |
| First-try valid          | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Valid after repair       | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Structure valid          | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Out-of-pool meal IDs     | 0.00             | 0.00              | ±0.00   | noise |
| Distinct dinner proteins | 4.25 (4.13–4.38) | 4.33 (4.25–4.38)  | +0.08   | noise |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 24                       | 24                       |
| Latency p50                                                           | 5.7s                     | 5.6s                     |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 8.8s                     | 9.1s                     |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2673 · 839 · 530 · 0 · 0 | 2673 · 774 · 465 · 0 · 0 |
| Cost / call                                                           | $0.0137                  | $0.0131                  |

## recipe

| Metric                 | golden               | claude-sonnet-5-5    | Delta   | Noise |
| ---------------------- | -------------------- | -------------------- | ------- | ----- |
| Ingredient recall      | 99.4% (98.2%–100.0%) | 99.4% (98.2%–100.0%) | ±0.0 pp | noise |
| Ingredient precision   | 99.4% (98.2%–100.0%) | 99.4% (98.2%–100.0%) | ±0.0 pp | noise |
| Quantity + unit exact  | 100.0%               | 100.0%               | ±0.0 pp | noise |
| Confidence tier agrees | 100.0%               | 100.0%               | ±0.0 pp | noise |
| Step count delta       | 0.38 (0.13–0.50)     | 0.08 (0.00–0.13)     | −0.29   | noise |

| Operational                                                           | golden                 | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Calls                                                                 | 27                     | 27                     |
| Latency p50                                                           | 5.1s                   | 5.1s                   |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 15.5s                  | 6.5s                   |
| Calls over budget                                                     | 0                      | 0                      |
| Calls retried (latency includes retries)                              | 0                      | 0                      |
| Errors                                                                | none                   | none                   |
| Truncated (`finishReason: length`)                                    | 0                      | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5259 · 710 · 0 · 0 · 0 | 5504 · 703 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0176                | $0.0180                |

## imagine

| Metric                    | golden | claude-sonnet-5-5 | Delta   | Noise |
| ------------------------- | ------ | ----------------- | ------- | ----- |
| All checks pass           | 100.0% | 100.0%            | ±0.0 pp | noise |
| Exactly 3 meals           | 100.0% | 100.0%            | ±0.0 pp | noise |
| Servings = household size | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≥ 2 ingredients each      | 100.0% | 100.0%            | ±0.0 pp | noise |
| No forbidden ingredient   | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                    | claude-sonnet-5-5         |
| --------------------------------------------------------------------- | ------------------------- | ------------------------- |
| Calls                                                                 | 24                        | 24                        |
| Latency p50                                                           | 19.1s                     | 19.3s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 25.8s                     | 24.5s                     |
| Calls over budget                                                     | 0                         | 0                         |
| Calls retried (latency includes retries)                              | 0                         | 0                         |
| Errors                                                                | none                      | none                      |
| Truncated (`finishReason: length`)                                    | 0                         | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3081 · 2831 · 925 · 0 · 0 | 3303 · 2704 · 819 · 0 · 0 |
| Cost / call                                                           | $0.0345                   | $0.0336                   |

## review

| Metric                         | golden              | claude-sonnet-5-5   | Delta   | Noise |
| ------------------------------ | ------------------- | ------------------- | ------- | ----- |
| Every ID exactly once          | 100.0%              | 100.0%              | ±0.0 pp | noise |
| Seeded errors corrected (±25%) | 80.0%               | 80.0%               | ±0.0 pp | noise |
| Correct quantities kept        | 93.8% (88.5%–97.9%) | 96.9% (94.8%–97.9%) | +3.1 pp | noise |

| Operational                                                           | golden                 | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ---------------------- | ----------------------- |
| Calls                                                                 | 24                     | 24                      |
| Latency p50                                                           | 1.8s                   | 2.3s                    |
| Latency max (budget 45.0s, `REVIEW_AI_BUDGET_MS`)                     | 5.8s                   | 5.4s                    |
| Calls over budget                                                     | 0                      | 0                       |
| Calls retried (latency includes retries)                              | 0                      | 0                       |
| Errors                                                                | none                   | none                    |
| Truncated (`finishReason: length`)                                    | 0                      | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1257 · 173 · 0 · 0 · 0 | 1257 · 231 · 57 · 0 · 0 |
| Cost / call                                                           | $0.0042                | $0.0048                 |

## tips

| Metric                 | golden | claude-sonnet-5-5 | Delta   | Noise |
| ---------------------- | ------ | ----------------- | ------- | ----- |
| Answered without error | 100.0% | 100.0%            | ±0.0 pp | noise |
| Item counts in range   | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                 | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Calls                                                                 | 24                     | 24                     |
| Latency p50                                                           | 4.9s                   | 4.8s                   |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 17.8s                  | 9.1s                   |
| Calls over budget                                                     | 0                      | 0                      |
| Calls retried (latency includes retries)                              | 0                      | 0                      |
| Errors                                                                | none                   | none                   |
| Truncated (`finishReason: length`)                                    | 0                      | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1894 · 405 · 0 · 0 · 0 | 2181 · 398 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0078                | $0.0083                |

## cook-question

| Metric                          | golden | claude-sonnet-5-5 | Delta   | Noise |
| ------------------------------- | ------ | ----------------- | ------- | ----- |
| Answered without error          | 100.0% | 100.0%            | ±0.0 pp | noise |
| Metric units only               | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≤ 100 words                     | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≤ 4 sentences                   | 100.0% | 100.0%            | ±0.0 pp | noise |
| Off-topic declined (≤ 50 words) | 100.0% | 100.0%            | ±0.0 pp | noise |
| No forbidden suggestion         | 100.0% | 100.0%            | ±0.0 pp | noise |
| Names the expected answer       | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 27                       | 27                       |
| Latency p50                                                           | 2.6s                     | 2.5s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 9.4s                     | 10.2s                    |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1123 · 293 · 175 · 0 · 0 | 1427 · 283 · 165 · 0 · 0 |
| Cost / call                                                           | $0.0052                  | $0.0057                  |

**Total cost:** $3.77 (claude-sonnet-5-5 $2.08 over 150 calls, judge claude-opus-5-5 $1.70 over 96 calls). The golden's $2.06 was spent when it was recorded.
