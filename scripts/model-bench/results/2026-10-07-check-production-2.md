# AI eval check: production configuration

2026-10-07 · 1 run(s) · tasks: imagine, cook-question · 29 calls

Models: imagine `claude-sonnet-5-5` · cook-question `claude-sonnet-5-5`

## Result

**Pass.** All 14 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task          | Gate                            | Observed | Threshold                                     | Result |
| ------------- | ------------------------------- | -------- | --------------------------------------------- | ------ |
| imagine       | All checks pass                 | 100.0%   | ≥ 100.0%                                      | pass   |
| imagine       | Exactly 3 meals                 | 100.0%   | ≥ 100.0%                                      | pass   |
| imagine       | Servings = household size       | 100.0%   | ≥ 100.0%                                      | pass   |
| imagine       | ≥ 2 ingredients each            | 100.0%   | ≥ 100.0%                                      | pass   |
| imagine       | No forbidden ingredient         | 100.0%   | ≥ 100.0%                                      | pass   |
| imagine       | Max latency                     | 29.1s    | ≤ 36.0s (80% of `IMAGINE_AI_BUDGET_MS`)       | pass   |
| cook-question | Answered without error          | 100.0%   | ≥ 100.0%                                      | pass   |
| cook-question | Metric units only               | 100.0%   | ≥ 100.0%                                      | pass   |
| cook-question | ≤ 100 words                     | 100.0%   | ≥ 90.0%                                       | pass   |
| cook-question | ≤ 4 sentences                   | 100.0%   | ≥ 90.0%                                       | pass   |
| cook-question | Off-topic declined (≤ 50 words) | 100.0%   | ≥ 100.0%                                      | pass   |
| cook-question | No forbidden suggestion         | 100.0%   | ≥ 100.0%                                      | pass   |
| cook-question | Names the expected answer       | 100.0%   | ≥ 90.0%                                       | pass   |
| cook-question | Max latency                     | 7.9s     | ≤ 24.0s (80% of `COOK_QUESTION_AI_BUDGET_MS`) | pass   |

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
| Calls                                                                 | 13                        |
| Latency p50                                                           | 23.6s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 29.1s                     |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3265 · 2741 · 836 · 0 · 0 |
| Cost / call                                                           | $0.0339                   |

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
| Calls                                                                 | 16                       |
| Latency p50                                                           | 2.0s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 7.9s                     |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1383 · 223 · 114 · 0 · 0 |
| Cost / call                                                           | $0.0050                  |

**Total cost:** $0.52 over 29 calls.
