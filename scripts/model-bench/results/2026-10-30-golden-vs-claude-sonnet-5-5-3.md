# Model benchmark: golden vs claude-sonnet-5-5

2026-10-30 · 3 run(s) · tasks: plan, recipe, imagine, review, tips, cook-question, adjust · 216 calls

**Baseline:** golden — plan `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s); recipe `claude-sonnet-5-5` recorded 2026-10-28 at `3e4f1b50`, 3 run(s); imagine `claude-sonnet-5-5` recorded 2026-10-07 at `27cf478d`, 3 run(s); review `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s); tips `claude-sonnet-5-5` recorded 2026-10-19 at `25370598`, 3 run(s); cook-question `claude-sonnet-5-5` recorded 2026-10-28 at `f6d90d79`, 3 run(s); adjust `claude-sonnet-5-5` recorded 2026-10-19 at `6d06896e`, 3 run(s).

**Prompts since the golden:** plan: prompt changed for 6 of 8 cases; recipe: prompt changed for 10 of 10 cases; imagine: prompt changed for 4 of 8 cases; review: unchanged; tips: prompt changed for 3 of 10 cases; cook-question: prompt changed for 6 of 17 cases; adjust: prompt changed for 4 of 11 cases.

## Not in golden

These cases are in the case set but not in the golden, so they have no baseline and were not run: re-record to include them (`pnpm ai-eval --record`).

- `imagine/en-dairy-allergy-mac-and-cheese` — re-record to include it
- `imagine/en-gluten-allergy-lasagne` — re-record to include it
- `imagine/en-sesame-allergy-poke-bowl` — re-record to include it
- `imagine/et-egg-allergy-pannkoogid` — re-record to include it
- `imagine/et-soy-allergy-wok` — re-record to include it

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **recipe · Quantity + unit exact:** 100.0% → 98.8% (−1.2 pp)

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **plan · Distinct dinner proteins:** 4.25 (4.13–4.38) → 4.33 (4.25–4.38) (+0.08)
- **recipe · Ingredient recall:** 100.0% → 98.9% (98.4%–100.0%) (−1.1 pp)
- **recipe · Ingredient precision:** 100.0% → 98.9% (98.4%–100.0%) (−1.1 pp)
- **recipe · Step count delta:** 0.44 → 0.33 (0.11–0.44) (−0.11)
- **review · Correct quantities kept:** 93.8% (88.5%–97.9%) → 93.6% (91.2%–94.8%) (−0.1 pp)

## Safety checks

The allergen and dietary checks, counted per call. No failure in a few dozen calls does not show the rate is zero: the figure in brackets is the highest failure rate still consistent with a clean result, at 95% confidence. Showing a rate under 5% takes 59 clean calls, and under 1% takes 299. Before a model change ships on a route with one of these checks, run enough cases or `--runs` that the bound is one you accept.

| Check                                   | golden                            | claude-sonnet-5-5                 |
| --------------------------------------- | --------------------------------- | --------------------------------- |
| imagine · No forbidden ingredient       | 0 of 24 failed (rate up to 11.7%) | 0 of 24 failed (rate up to 11.7%) |
| cook-question · No forbidden suggestion | 0 of 24 failed (rate up to 11.7%) | 0 of 24 failed (rate up to 11.7%) |
| adjust · No forbidden replacement       | 0 of 3 failed (rate up to 63.2%)  | 0 of 3 failed (rate up to 63.2%)  |

## Judge

Counts are for claude-sonnet-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task          | Wins | Ties | Losses | Skipped | Judge errors | Win rate                     |
| ------------- | ---- | ---- | ------ | ------- | ------------ | ---------------------------- |
| imagine       | 14   | 6    | 4      | 0       | 0            | 77.8% (14 won of 18 decided) |
| tips          | 11   | 7    | 12     | 0       | 0            | 47.8% (11 won of 23 decided) |
| cook-question | 16   | 21   | 14     | 0       | 0            | 53.3% (16 won of 30 decided) |

## plan

| Metric                            | golden           | claude-sonnet-5-5 | Delta   | Noise |
| --------------------------------- | ---------------- | ----------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0%           | 100.0%            | ±0.0 pp | noise |
| First-try valid                   | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Valid after repair                | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Structure valid                   | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Out-of-pool meal IDs              | 0.00             | 0.00              | ±0.00   | noise |
| Distinct dinner proteins          | 4.25 (4.13–4.38) | 4.33 (4.25–4.38)  | +0.08   | noise |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 24                       | 24                       |
| Latency p50                                                           | 5.7s                     | 5.4s                     |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 8.8s                     | 9.5s                     |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2673 · 839 · 530 · 0 · 0 | 2673 · 816 · 507 · 0 · 0 |
| Cost / call                                                           | $0.0137                  | $0.0135                  |

## recipe

| Metric                            | golden | claude-sonnet-5-5    | Delta   | Noise         |
| --------------------------------- | ------ | -------------------- | ------- | ------------- |
| Completed (no error, not cut off) | 100.0% | 100.0%               | ±0.0 pp | noise         |
| Ingredient recall                 | 100.0% | 98.9% (98.4%–100.0%) | −1.1 pp | noise         |
| Ingredient precision              | 100.0% | 98.9% (98.4%–100.0%) | −1.1 pp | noise         |
| Quantity + unit exact             | 100.0% | 98.8%                | −1.2 pp | outside range |
| Confidence tier agrees            | 100.0% | 100.0%               | ±0.0 pp | noise         |
| Step count delta                  | 0.44   | 0.33 (0.11–0.44)     | −0.11   | noise         |
| Servings match                    | 100.0% | 100.0%               | ±0.0 pp | noise         |

| Operational                                                           | golden                  | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- | ----------------------- |
| Calls                                                                 | 30                      | 30                      |
| Latency p50                                                           | 4.8s                    | 4.7s                    |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 8.2s                    | 9.1s                    |
| Calls over budget                                                     | 0                       | 0                       |
| Calls retried (latency includes retries)                              | 0                       | 0                       |
| Errors                                                                | none                    | none                    |
| Truncated (`finishReason: length`)                                    | 0                       | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5451 · 709 · 20 · 0 · 0 | 5588 · 771 · 83 · 0 · 0 |
| Cost / call                                                           | $0.0180                 | $0.0189                 |

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
| Latency p50                                                           | 18.8s                     | 18.8s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 23.2s                     | 23.0s                     |
| Calls over budget                                                     | 0                         | 0                         |
| Calls retried (latency includes retries)                              | 0                         | 0                         |
| Errors                                                                | none                      | none                      |
| Truncated (`finishReason: length`)                                    | 0                         | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3303 · 2617 · 780 · 0 · 0 | 3302 · 2681 · 800 · 0 · 0 |
| Cost / call                                                           | $0.0328                   | $0.0334                   |

## review

| Metric                            | golden              | claude-sonnet-5-5   | Delta   | Noise |
| --------------------------------- | ------------------- | ------------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0%              | 100.0%              | ±0.0 pp | noise |
| Every ID exactly once             | 100.0%              | 100.0%              | ±0.0 pp | noise |
| Seeded errors corrected (±25%)    | 80.0%               | 80.0%               | ±0.0 pp | noise |
| Correct quantities kept           | 93.8% (88.5%–97.9%) | 93.6% (91.2%–94.8%) | −0.1 pp | noise |

| Operational                                                           | golden                 | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Calls                                                                 | 24                     | 24                     |
| Latency p50                                                           | 1.8s                   | 1.7s                   |
| Latency max (budget 45.0s, `REVIEW_AI_BUDGET_MS`)                     | 5.8s                   | 2.5s                   |
| Calls over budget                                                     | 0                      | 0                      |
| Calls retried (latency includes retries)                              | 0                      | 0                      |
| Errors                                                                | none                   | none                   |
| Truncated (`finishReason: length`)                                    | 0                      | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1257 · 173 · 0 · 0 · 0 | 1257 · 173 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0042                | $0.0042                |

## tips

| Metric                                        | golden | claude-sonnet-5-5 | Delta   | Noise |
| --------------------------------------------- | ------ | ----------------- | ------- | ----- |
| Completed (no error, not cut off)             | 100.0% | 100.0%            | ±0.0 pp | noise |
| Answered without error                        | 100.0% | 100.0%            | ±0.0 pp | noise |
| Item counts in range                          | 100.0% | 100.0%            | ±0.0 pp | noise |
| Follows the adjustment instruction            | 100.0% | 100.0%            | ±0.0 pp | noise |
| Leaves out what the changed list doesn't have | 100.0% | 100.0%            | ±0.0 pp | noise |
| Keeps the notes' times and temperatures       | 100.0% | 100.0%            | ±0.0 pp | noise |
| No step made from a note that is not a method | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 30                       | 30                       |
| Latency p50                                                           | 6.5s                     | 5.2s                     |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 9.9s                     | 11.2s                    |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2469 · 639 · 151 · 0 · 0 | 2469 · 584 · 110 · 0 · 0 |
| Cost / call                                                           | $0.0113                  | $0.0108                  |

## cook-question

| Metric                                        | golden | claude-sonnet-5-5 | Delta   | Noise |
| --------------------------------------------- | ------ | ----------------- | ------- | ----- |
| Completed (no error, not cut off)             | 100.0% | 100.0%            | ±0.0 pp | noise |
| Answered without error                        | 100.0% | 100.0%            | ±0.0 pp | noise |
| Metric units only                             | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≤ 100 words                                   | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≤ 4 sentences                                 | 100.0% | 100.0%            | ±0.0 pp | noise |
| Off-topic declined (≤ 50 words)               | 100.0% | 100.0%            | ±0.0 pp | noise |
| No forbidden suggestion                       | 100.0% | 100.0%            | ±0.0 pp | noise |
| No unbacked claim                             | 100.0% | 100.0%            | ±0.0 pp | noise |
| Names the expected answer                     | 100.0% | 100.0%            | ±0.0 pp | noise |
| Leaves out what the changed list doesn't have | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 51                       | 51                       |
| Latency p50                                                           | 2.2s                     | 2.4s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 11.5s                    | 9.5s                     |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1511 · 227 · 118 · 0 · 0 | 1510 · 217 · 108 · 0 · 0 |
| Cost / call                                                           | $0.0053                  | $0.0052                  |

## adjust

| Metric                                         | golden | claude-sonnet-5-5 | Delta   | Noise |
| ---------------------------------------------- | ------ | ----------------- | ------- | ----- |
| Completed (no error, not cut off)              | 100.0% | 100.0%            | ±0.0 pp | noise |
| Answered without error                         | 100.0% | 100.0%            | ±0.0 pp | noise |
| Every original is a listed ingredient          | 100.0% | 100.0%            | ±0.0 pp | noise |
| Every replacement has an amount and a unit     | 100.0% | 100.0%            | ±0.0 pp | noise |
| Proposes the expected changes                  | 100.0% | 100.0%            | ±0.0 pp | noise |
| No change when none is needed                  | 100.0% | 100.0%            | ±0.0 pp | noise |
| Flags an instruction only the steps can follow | 100.0% | 100.0%            | ±0.0 pp | noise |
| No forbidden replacement                       | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                  | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- | ----------------------- |
| Calls                                                                 | 33                      | 33                      |
| Latency p50                                                           | 2.0s                    | 1.7s                    |
| Latency max (budget 30.0s, `ADJUST_AI_BUDGET_MS`)                     | 2.9s                    | 2.5s                    |
| Calls over budget                                                     | 0                       | 0                       |
| Calls retried (latency includes retries)                              | 0                       | 0                       |
| Errors                                                                | none                    | none                    |
| Truncated (`finishReason: length`)                                    | 0                       | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2058 · 100 · 13 · 0 · 0 | 2057 · 101 · 14 · 0 · 0 |
| Cost / call                                                           | $0.0051                 | $0.0051                 |

**Total cost:** $2.55 (claude-sonnet-5-5 $2.55 over 216 calls, judge claude-code/opus $0.0000 over 210 calls). The golden's $2.54 was spent when it was recorded.
