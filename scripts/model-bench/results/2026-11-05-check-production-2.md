# AI eval check: production configuration

2026-11-05 · 3 run(s) · tasks: plan, recipe, imagine, review, tips, cook-question, adjust · 240 calls

Models: plan `claude-sonnet-5-5` · recipe `claude-sonnet-5-5` · imagine `claude-sonnet-5-5` · review `claude-sonnet-5-5` · tips `claude-sonnet-5-5` · cook-question `claude-sonnet-5-5` · adjust `claude-sonnet-5-5`

## Result

**Fail.** 1 of 47 gates failed:

- **tips · Keeps the notes' times and temperatures:** 77.8% (66.7%–100.0%), needs ≥ 100.0%

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task          | Gate                                           | Observed             | Threshold                                                  | Result   |
| ------------- | ---------------------------------------------- | -------------------- | ---------------------------------------------------------- | -------- |
| plan          | First-try valid                                | 100.0%               | ≥ 100.0%                                                   | pass     |
| plan          | Valid after repair                             | 100.0%               | ≥ 100.0%                                                   | pass     |
| plan          | Structure valid                                | 100.0%               | ≥ 100.0%                                                   | pass     |
| plan          | Out-of-pool meal IDs                           | 0.00                 | ≤ 0.00                                                     | pass     |
| plan          | Max latency                                    | 9.4s                 | ≤ 32.0s (80% of `PLAN_AI_BUDGET_MS`)                       | pass     |
| recipe        | Ingredient recall                              | 99.5% (98.5%–100.0%) | ≥ 95.0%                                                    | pass     |
| recipe        | Ingredient precision                           | 99.5% (98.5%–100.0%) | ≥ 95.0%                                                    | pass     |
| recipe        | Quantity + unit exact                          | 100.0%               | ≥ 100.0%                                                   | pass     |
| recipe        | Confidence tier agrees                         | 100.0%               | ≥ 100.0%                                                   | pass     |
| recipe        | Servings match                                 | 100.0%               | ≥ 100.0%                                                   | pass     |
| recipe        | Max latency                                    | 9.9s                 | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass     |
| imagine       | All checks pass                                | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | Exactly 3 meals                                | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | Servings = household size                      | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | ≥ 2 ingredients each                           | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | No forbidden ingredient                        | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | Max latency                                    | 28.9s                | ≤ 36.0s (80% of `IMAGINE_AI_BUDGET_MS`)                    | pass     |
| review        | Every ID exactly once                          | 100.0%               | ≥ 100.0%                                                   | pass     |
| review        | Seeded errors corrected (±25%)                 | 80.0%                | ≥ 70.0%                                                    | pass     |
| review        | Correct quantities kept                        | 93.5% (87.8%–97.9%)  | ≥ 85.0%                                                    | pass     |
| review        | Max latency                                    | 3.3s                 | ≤ 36.0s (80% of `REVIEW_AI_BUDGET_MS`)                     | pass     |
| tips          | Answered without error                         | 100.0%               | ≥ 100.0%                                                   | pass     |
| tips          | Item counts in range                           | 100.0%               | ≥ 90.0%                                                    | pass     |
| tips          | Follows the adjustment instruction             | 100.0%               | ≥ 80.0%                                                    | pass     |
| tips          | Leaves out what the changed list doesn't have  | 100.0%               | ≥ 100.0%                                                   | pass     |
| tips          | Keeps the notes' times and temperatures        | 77.8% (66.7%–100.0%) | ≥ 100.0%                                                   | **fail** |
| tips          | No step made from a note that is not a method  | 100.0%               | ≥ 100.0%                                                   | pass     |
| tips          | Max latency                                    | 9.8s                 | ≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`)                      | pass     |
| cook-question | Answered without error                         | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | Metric units only                              | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | ≤ 100 words                                    | 100.0%               | ≥ 90.0%                                                    | pass     |
| cook-question | ≤ 4 sentences                                  | 100.0%               | ≥ 90.0%                                                    | pass     |
| cook-question | Off-topic declined (≤ 50 words)                | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | No forbidden suggestion                        | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | No unbacked claim                              | 100.0%               | ≥ 85.0%                                                    | pass     |
| cook-question | No draft or note to itself                     | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | Names the expected answer                      | 100.0%               | ≥ 90.0%                                                    | pass     |
| cook-question | Leaves out what the changed list doesn't have  | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | Max latency                                    | 9.9s                 | ≤ 24.0s (80% of `COOK_QUESTION_AI_BUDGET_MS`)              | pass     |
| adjust        | Answered without error                         | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Every original is a listed ingredient          | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Every replacement has an amount and a unit     | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Proposes the expected changes                  | 100.0%               | ≥ 90.0%                                                    | pass     |
| adjust        | No change when none is needed                  | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Flags an instruction only the steps can follow | 100.0%               | ≥ 80.0%                                                    | pass     |
| adjust        | No forbidden replacement                       | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Max latency                                    | 2.9s                 | ≤ 24.0s (80% of `ADJUST_AI_BUDGET_MS`)                     | pass     |

## plan

| Metric                   | claude-sonnet-5-5 | Gate     |
| ------------------------ | ----------------- | -------- |
| First-try valid          | 100.0%            | ≥ 100.0% |
| Valid after repair       | 100.0%            | ≥ 100.0% |
| Structure valid          | 100.0%            | ≥ 100.0% |
| Out-of-pool meal IDs     | 0.00              | ≤ 0.00   |
| Distinct dinner proteins | 4.33 (4.25–4.38)  | —        |

| Operational                                                           | claude-sonnet-5-5          |
| --------------------------------------------------------------------- | -------------------------- |
| Calls                                                                 | 24                         |
| Latency p50                                                           | 5.8s                       |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 9.4s                       |
| Calls over budget                                                     | 0                          |
| Calls retried (latency includes retries)                              | 0                          |
| Errors                                                                | none                       |
| Truncated (`finishReason: length`)                                    | 0                          |
| Tokens / call (input · output · reasoning · cache read · cache write) | 4 · 813 · 504 · 1779 · 890 |
| Cost / call                                                           | $0.0107                    |

## recipe

| Metric                 | claude-sonnet-5-5    | Gate     |
| ---------------------- | -------------------- | -------- |
| Ingredient recall      | 99.5% (98.5%–100.0%) | ≥ 95.0%  |
| Ingredient precision   | 99.5% (98.5%–100.0%) | ≥ 95.0%  |
| Quantity + unit exact  | 100.0%               | ≥ 100.0% |
| Confidence tier agrees | 100.0%               | ≥ 100.0% |
| Step count delta       | 0.52 (0.45–0.64)     | —        |
| Servings match         | 100.0%               | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5           |
| --------------------------------------------------------------------- | --------------------------- |
| Calls                                                                 | 36                          |
| Latency p50                                                           | 5.1s                        |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 9.9s                        |
| Calls over budget                                                     | 0                           |
| Calls retried (latency includes retries)                              | 0                           |
| Errors                                                                | none                        |
| Truncated (`finishReason: length`)                                    | 0                           |
| Tokens / call (input · output · reasoning · cache read · cache write) | 4 · 827 · 127 · 4286 · 2143 |
| Cost / call                                                           | $0.0145                     |

## imagine

| Metric                    | claude-sonnet-5-5 | Gate     |
| ------------------------- | ----------------- | -------- |
| All checks pass           | 100.0%            | ≥ 100.0% |
| Exactly 3 meals           | 100.0%            | ≥ 100.0% |
| Servings = household size | 100.0%            | ≥ 100.0% |
| ≥ 2 ingredients each      | 100.0%            | ≥ 100.0% |
| No forbidden ingredient   | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5            |
| --------------------------------------------------------------------- | ---------------------------- |
| Calls                                                                 | 39                           |
| Latency p50                                                           | 18.1s                        |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 28.9s                        |
| Calls over budget                                                     | 0                            |
| Calls retried (latency includes retries)                              | 0                            |
| Errors                                                                | none                         |
| Truncated (`finishReason: length`)                                    | 0                            |
| Tokens / call (input · output · reasoning · cache read · cache write) | 4 · 2779 · 942 · 2332 · 1166 |
| Cost / call                                                           | $0.0312                      |

## review

| Metric                         | claude-sonnet-5-5   | Gate     |
| ------------------------------ | ------------------- | -------- |
| Every ID exactly once          | 100.0%              | ≥ 100.0% |
| Seeded errors corrected (±25%) | 80.0%               | ≥ 70.0%  |
| Correct quantities kept        | 93.5% (87.8%–97.9%) | ≥ 85.0%  |

| Operational                                                           | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- |
| Calls                                                                 | 24                      |
| Latency p50                                                           | 1.7s                    |
| Latency max (budget 45.0s, `REVIEW_AI_BUDGET_MS`)                     | 3.3s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 4 · 173 · 0 · 835 · 418 |
| Cost / call                                                           | $0.0030                 |

## tips

| Metric                                        | claude-sonnet-5-5    | Gate     |
| --------------------------------------------- | -------------------- | -------- |
| Answered without error                        | 100.0%               | ≥ 100.0% |
| Item counts in range                          | 100.0%               | ≥ 90.0%  |
| Follows the adjustment instruction            | 100.0%               | ≥ 80.0%  |
| Leaves out what the changed list doesn't have | 100.0%               | ≥ 100.0% |
| Keeps the notes' times and temperatures       | 77.8% (66.7%–100.0%) | ≥ 100.0% |
| No step made from a note that is not a method | 100.0%               | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5          |
| --------------------------------------------------------------------- | -------------------------- |
| Calls                                                                 | 30                         |
| Latency p50                                                           | 5.1s                       |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 9.8s                       |
| Calls over budget                                                     | 0                          |
| Calls retried (latency includes retries)                              | 0                          |
| Errors                                                                | none                       |
| Truncated (`finishReason: length`)                                    | 0                          |
| Tokens / call (input · output · reasoning · cache read · cache write) | 4 · 589 · 125 · 1643 · 822 |
| Cost / call                                                           | $0.0083                    |

## cook-question

| Metric                                        | claude-sonnet-5-5 | Gate     |
| --------------------------------------------- | ----------------- | -------- |
| Answered without error                        | 100.0%            | ≥ 100.0% |
| Metric units only                             | 100.0%            | ≥ 100.0% |
| ≤ 100 words                                   | 100.0%            | ≥ 90.0%  |
| ≤ 4 sentences                                 | 100.0%            | ≥ 90.0%  |
| Off-topic declined (≤ 50 words)               | 100.0%            | ≥ 100.0% |
| No forbidden suggestion                       | 100.0%            | ≥ 100.0% |
| No unbacked claim                             | 100.0%            | ≥ 85.0%  |
| No draft or note to itself                    | 100.0%            | ≥ 100.0% |
| Names the expected answer                     | 100.0%            | ≥ 90.0%  |
| Leaves out what the changed list doesn't have | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5         |
| --------------------------------------------------------------------- | ------------------------- |
| Calls                                                                 | 54                        |
| Latency p50                                                           | 2.5s                      |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 9.9s                      |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 4 · 214 · 98 · 1074 · 537 |
| Cost / call                                                           | $0.0037                   |

## adjust

| Metric                                         | claude-sonnet-5-5 | Gate     |
| ---------------------------------------------- | ----------------- | -------- |
| Answered without error                         | 100.0%            | ≥ 100.0% |
| Every original is a listed ingredient          | 100.0%            | ≥ 100.0% |
| Every replacement has an amount and a unit     | 100.0%            | ≥ 100.0% |
| Proposes the expected changes                  | 100.0%            | ≥ 90.0%  |
| No change when none is needed                  | 100.0%            | ≥ 100.0% |
| Flags an instruction only the steps can follow | 100.0%            | ≥ 80.0%  |
| No forbidden replacement                       | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5         |
| --------------------------------------------------------------------- | ------------------------- |
| Calls                                                                 | 33                        |
| Latency p50                                                           | 1.7s                      |
| Latency max (budget 30.0s, `ADJUST_AI_BUDGET_MS`)                     | 2.9s                      |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 4 · 102 · 15 · 1369 · 684 |
| Cost / call                                                           | $0.0030                   |

**Total cost:** $2.61 over 240 calls.
