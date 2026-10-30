# AI eval check: production configuration

2026-10-30 · 3 run(s) · tasks: plan, recipe, imagine, tips, cook-question, adjust · 207 calls

Models: plan `claude-sonnet-5-5` · recipe `claude-sonnet-5-5` · imagine `claude-sonnet-5-5` · tips `claude-sonnet-5-5` · cook-question `claude-sonnet-5-5` · adjust `claude-sonnet-5-5`

## Result

**Fail.** 2 of 42 gates failed:

- **recipe · Quantity + unit exact:** 99.6% (98.8%–100.0%), needs ≥ 100.0%
- **cook-question · Answered without error:** 98.0% (94.1%–100.0%), needs ≥ 100.0%

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task          | Gate                                           | Observed             | Threshold                                                  | Result   |
| ------------- | ---------------------------------------------- | -------------------- | ---------------------------------------------------------- | -------- |
| plan          | First-try valid                                | 100.0%               | ≥ 100.0%                                                   | pass     |
| plan          | Valid after repair                             | 100.0%               | ≥ 100.0%                                                   | pass     |
| plan          | Structure valid                                | 100.0%               | ≥ 100.0%                                                   | pass     |
| plan          | Out-of-pool meal IDs                           | 0.00                 | ≤ 0.00                                                     | pass     |
| plan          | Max latency                                    | 15.0s                | ≤ 32.0s (80% of `PLAN_AI_BUDGET_MS`)                       | pass     |
| recipe        | Ingredient recall                              | 100.0%               | ≥ 95.0%                                                    | pass     |
| recipe        | Ingredient precision                           | 100.0%               | ≥ 95.0%                                                    | pass     |
| recipe        | Quantity + unit exact                          | 99.6% (98.8%–100.0%) | ≥ 100.0%                                                   | **fail** |
| recipe        | Confidence tier agrees                         | 100.0%               | ≥ 100.0%                                                   | pass     |
| recipe        | Servings match                                 | 100.0%               | ≥ 100.0%                                                   | pass     |
| recipe        | Max latency                                    | 9.3s                 | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass     |
| imagine       | All checks pass                                | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | Exactly 3 meals                                | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | Servings = household size                      | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | ≥ 2 ingredients each                           | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | No forbidden ingredient                        | 100.0%               | ≥ 100.0%                                                   | pass     |
| imagine       | Max latency                                    | 23.8s                | ≤ 36.0s (80% of `IMAGINE_AI_BUDGET_MS`)                    | pass     |
| tips          | Answered without error                         | 100.0%               | ≥ 100.0%                                                   | pass     |
| tips          | Item counts in range                           | 100.0%               | ≥ 90.0%                                                    | pass     |
| tips          | Follows the adjustment instruction             | 100.0%               | ≥ 80.0%                                                    | pass     |
| tips          | Leaves out what the changed list doesn't have  | 100.0%               | ≥ 100.0%                                                   | pass     |
| tips          | Keeps the notes' times and temperatures        | 100.0%               | ≥ 100.0%                                                   | pass     |
| tips          | No step made from a note that is not a method  | 100.0%               | ≥ 100.0%                                                   | pass     |
| tips          | Max latency                                    | 10.2s                | ≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`)                      | pass     |
| cook-question | Answered without error                         | 98.0% (94.1%–100.0%) | ≥ 100.0%                                                   | **fail** |
| cook-question | Metric units only                              | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | ≤ 100 words                                    | 100.0%               | ≥ 90.0%                                                    | pass     |
| cook-question | ≤ 4 sentences                                  | 100.0%               | ≥ 90.0%                                                    | pass     |
| cook-question | Off-topic declined (≤ 50 words)                | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | No forbidden suggestion                        | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | No unbacked claim                              | 100.0%               | ≥ 85.0%                                                    | pass     |
| cook-question | Names the expected answer                      | 100.0%               | ≥ 90.0%                                                    | pass     |
| cook-question | Leaves out what the changed list doesn't have  | 100.0%               | ≥ 100.0%                                                   | pass     |
| cook-question | Max latency                                    | 11.7s                | ≤ 24.0s (80% of `COOK_QUESTION_AI_BUDGET_MS`)              | pass     |
| adjust        | Answered without error                         | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Every original is a listed ingredient          | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Every replacement has an amount and a unit     | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Proposes the expected changes                  | 100.0%               | ≥ 90.0%                                                    | pass     |
| adjust        | No change when none is needed                  | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Flags an instruction only the steps can follow | 100.0%               | ≥ 80.0%                                                    | pass     |
| adjust        | No forbidden replacement                       | 100.0%               | ≥ 100.0%                                                   | pass     |
| adjust        | Max latency                                    | 6.0s                 | ≤ 24.0s (80% of `ADJUST_AI_BUDGET_MS`)                     | pass     |

## plan

| Metric                   | claude-sonnet-5-5 | Gate     |
| ------------------------ | ----------------- | -------- |
| First-try valid          | 100.0%            | ≥ 100.0% |
| Valid after repair       | 100.0%            | ≥ 100.0% |
| Structure valid          | 100.0%            | ≥ 100.0% |
| Out-of-pool meal IDs     | 0.00              | ≤ 0.00   |
| Distinct dinner proteins | 4.38 (4.25–4.50)  | —        |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 24                       |
| Latency p50                                                           | 5.9s                     |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 15.0s                    |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2673 · 843 · 534 · 0 · 0 |
| Cost / call                                                           | $0.0138                  |

## recipe

| Metric                 | claude-sonnet-5-5    | Gate     |
| ---------------------- | -------------------- | -------- |
| Ingredient recall      | 100.0%               | ≥ 95.0%  |
| Ingredient precision   | 100.0%               | ≥ 95.0%  |
| Quantity + unit exact  | 99.6% (98.8%–100.0%) | ≥ 100.0% |
| Confidence tier agrees | 100.0%               | ≥ 100.0% |
| Step count delta       | 0.41 (0.33–0.44)     | —        |
| Servings match         | 100.0%               | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- |
| Calls                                                                 | 30                      |
| Latency p50                                                           | 4.8s                    |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 9.3s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5588 · 784 · 94 · 0 · 0 |
| Cost / call                                                           | $0.0190                 |

## imagine

| Metric                    | claude-sonnet-5-5 | Gate     |
| ------------------------- | ----------------- | -------- |
| All checks pass           | 100.0%            | ≥ 100.0% |
| Exactly 3 meals           | 100.0%            | ≥ 100.0% |
| Servings = household size | 100.0%            | ≥ 100.0% |
| ≥ 2 ingredients each      | 100.0%            | ≥ 100.0% |
| No forbidden ingredient   | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5         |
| --------------------------------------------------------------------- | ------------------------- |
| Calls                                                                 | 39                        |
| Latency p50                                                           | 18.2s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 23.8s                     |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3264 · 2751 · 859 · 0 · 0 |
| Cost / call                                                           | $0.0340                   |

## tips

| Metric                                        | claude-sonnet-5-5 | Gate     |
| --------------------------------------------- | ----------------- | -------- |
| Answered without error                        | 100.0%            | ≥ 100.0% |
| Item counts in range                          | 100.0%            | ≥ 90.0%  |
| Follows the adjustment instruction            | 100.0%            | ≥ 80.0%  |
| Leaves out what the changed list doesn't have | 100.0%            | ≥ 100.0% |
| Keeps the notes' times and temperatures       | 100.0%            | ≥ 100.0% |
| No step made from a note that is not a method | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 30                       |
| Latency p50                                                           | 5.7s                     |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 10.2s                    |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2469 · 616 · 140 · 0 · 0 |
| Cost / call                                                           | $0.0111                  |

## cook-question

| Metric                                        | claude-sonnet-5-5    | Gate     |
| --------------------------------------------- | -------------------- | -------- |
| Answered without error                        | 98.0% (94.1%–100.0%) | ≥ 100.0% |
| Metric units only                             | 100.0%               | ≥ 100.0% |
| ≤ 100 words                                   | 100.0%               | ≥ 90.0%  |
| ≤ 4 sentences                                 | 100.0%               | ≥ 90.0%  |
| Off-topic declined (≤ 50 words)               | 100.0%               | ≥ 100.0% |
| No forbidden suggestion                       | 100.0%               | ≥ 100.0% |
| No unbacked claim                             | 100.0%               | ≥ 85.0%  |
| Names the expected answer                     | 100.0%               | ≥ 90.0%  |
| Leaves out what the changed list doesn't have | 100.0%               | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5             |
| --------------------------------------------------------------------- | ----------------------------- |
| Calls                                                                 | 51                            |
| Latency p50                                                           | 2.2s                          |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 11.7s                         |
| Calls over budget                                                     | 0                             |
| Calls retried (latency includes retries)                              | 0                             |
| Errors                                                                | AI_NoObjectGeneratedError × 1 |
| Truncated (`finishReason: length`)                                    | 1                             |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1510 · 223 · 116 · 0 · 0      |
| Cost / call                                                           | $0.0052                       |

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

| Operational                                                           | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- |
| Calls                                                                 | 33                      |
| Latency p50                                                           | 1.9s                    |
| Latency max (budget 30.0s, `ADJUST_AI_BUDGET_MS`)                     | 6.0s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2057 · 101 · 14 · 0 · 0 |
| Cost / call                                                           | $0.0051                 |

**Total cost:** $3.00 over 207 calls.
