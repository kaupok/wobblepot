# AI eval check: production configuration

2026-10-07 · 3 run(s) · tasks: recipe, imagine, tips, cook-question · 102 calls

Models: recipe `claude-sonnet-5-5` · imagine `claude-sonnet-5-5` · tips `claude-sonnet-5-5` · cook-question `claude-sonnet-5-5`

## Result

**Pass.** All 22 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task          | Gate                            | Observed | Threshold                                                  | Result |
| ------------- | ------------------------------- | -------- | ---------------------------------------------------------- | ------ |
| recipe        | Ingredient recall               | 100.0%   | ≥ 95.0%                                                    | pass   |
| recipe        | Ingredient precision            | 100.0%   | ≥ 95.0%                                                    | pass   |
| recipe        | Quantity + unit exact           | 100.0%   | ≥ 100.0%                                                   | pass   |
| recipe        | Confidence tier agrees          | 100.0%   | ≥ 100.0%                                                   | pass   |
| recipe        | Max latency                     | 5.9s     | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass   |
| imagine       | All checks pass                 | 100.0%   | ≥ 100.0%                                                   | pass   |
| imagine       | Exactly 3 meals                 | 100.0%   | ≥ 100.0%                                                   | pass   |
| imagine       | Servings = household size       | 100.0%   | ≥ 100.0%                                                   | pass   |
| imagine       | ≥ 2 ingredients each            | 100.0%   | ≥ 100.0%                                                   | pass   |
| imagine       | No forbidden ingredient         | 100.0%   | ≥ 100.0%                                                   | pass   |
| imagine       | Max latency                     | 23.2s    | ≤ 36.0s (80% of `IMAGINE_AI_BUDGET_MS`)                    | pass   |
| tips          | Answered without error          | 100.0%   | ≥ 100.0%                                                   | pass   |
| tips          | Item counts in range            | 100.0%   | ≥ 90.0%                                                    | pass   |
| tips          | Max latency                     | 9.3s     | ≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`)                      | pass   |
| cook-question | Answered without error          | 100.0%   | ≥ 100.0%                                                   | pass   |
| cook-question | Metric units only               | 100.0%   | ≥ 100.0%                                                   | pass   |
| cook-question | ≤ 100 words                     | 100.0%   | ≥ 90.0%                                                    | pass   |
| cook-question | ≤ 4 sentences                   | 100.0%   | ≥ 90.0%                                                    | pass   |
| cook-question | Off-topic declined (≤ 50 words) | 100.0%   | ≥ 100.0%                                                   | pass   |
| cook-question | No forbidden suggestion         | 100.0%   | ≥ 100.0%                                                   | pass   |
| cook-question | Names the expected answer       | 100.0%   | ≥ 90.0%                                                    | pass   |
| cook-question | Max latency                     | 10.5s    | ≤ 24.0s (80% of `COOK_QUESTION_AI_BUDGET_MS`)              | pass   |

## recipe

| Metric                 | claude-sonnet-5-5 | Gate     |
| ---------------------- | ----------------- | -------- |
| Ingredient recall      | 100.0%            | ≥ 95.0%  |
| Ingredient precision   | 100.0%            | ≥ 95.0%  |
| Quantity + unit exact  | 100.0%            | ≥ 100.0% |
| Confidence tier agrees | 100.0%            | ≥ 100.0% |
| Step count delta       | 0.08 (0.00–0.13)  | —        |

| Operational                                                           | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- |
| Calls                                                                 | 27                     |
| Latency p50                                                           | 4.9s                   |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 5.9s                   |
| Calls over budget                                                     | 0                      |
| Calls retried (latency includes retries)                              | 0                      |
| Errors                                                                | none                   |
| Truncated (`finishReason: length`)                                    | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5504 · 702 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0180                |

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
| Calls                                                                 | 24                        |
| Latency p50                                                           | 18.8s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 23.2s                     |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3303 · 2617 · 780 · 0 · 0 |
| Cost / call                                                           | $0.0328                   |

## tips

| Metric                 | claude-sonnet-5-5 | Gate     |
| ---------------------- | ----------------- | -------- |
| Answered without error | 100.0%            | ≥ 100.0% |
| Item counts in range   | 100.0%            | ≥ 90.0%  |

| Operational                                                           | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- |
| Calls                                                                 | 24                     |
| Latency p50                                                           | 4.8s                   |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 9.3s                   |
| Calls over budget                                                     | 0                      |
| Calls retried (latency includes retries)                              | 0                      |
| Errors                                                                | none                   |
| Truncated (`finishReason: length`)                                    | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2181 · 401 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0084                |

## cook-question

| Metric                          | claude-sonnet-5-5 | Gate     |
| ------------------------------- | ----------------- | -------- |
| Answered without error          | 100.0%            | ≥ 100.0% |
| Metric units only               | 100.0%            | ≥ 100.0% |
| ≤ 100 words                     | 100.0%            | ≥ 90.0%  |
| ≤ 4 sentences                   | 100.0%            | ≥ 90.0%  |
| Off-topic declined (≤ 50 words) | 100.0%            | ≥ 100.0% |
| No forbidden suggestion         | 100.0%            | ≥ 100.0% |
| Names the expected answer       | 100.0%            | ≥ 90.0%  |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 27                       |
| Latency p50                                                           | 2.5s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 10.5s                    |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1427 · 283 · 168 · 0 · 0 |
| Cost / call                                                           | $0.0057                  |

**Total cost:** $1.63 over 102 calls.
