# AI eval check: production configuration

2026-10-09 · 3 run(s) · tasks: cook-question · 48 calls

Models: cook-question `claude-sonnet-5-5`

## Result

**Pass.** All 9 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task          | Gate                            | Observed | Threshold                                     | Result |
| ------------- | ------------------------------- | -------- | --------------------------------------------- | ------ |
| cook-question | Answered without error          | 100.0%   | ≥ 100.0%                                      | pass   |
| cook-question | Metric units only               | 100.0%   | ≥ 100.0%                                      | pass   |
| cook-question | ≤ 100 words                     | 100.0%   | ≥ 90.0%                                       | pass   |
| cook-question | ≤ 4 sentences                   | 100.0%   | ≥ 90.0%                                       | pass   |
| cook-question | Off-topic declined (≤ 50 words) | 100.0%   | ≥ 100.0%                                      | pass   |
| cook-question | No forbidden suggestion         | 100.0%   | ≥ 100.0%                                      | pass   |
| cook-question | No unbacked claim               | 100.0%   | ≥ 60.0%                                       | pass   |
| cook-question | Names the expected answer       | 100.0%   | ≥ 90.0%                                       | pass   |
| cook-question | Max latency                     | 9.6s     | ≤ 24.0s (80% of `COOK_QUESTION_AI_BUDGET_MS`) | pass   |

## cook-question

| Metric                          | claude-sonnet-5-5 | Gate     |
| ------------------------------- | ----------------- | -------- |
| Answered without error          | 100.0%            | ≥ 100.0% |
| Metric units only               | 100.0%            | ≥ 100.0% |
| ≤ 100 words                     | 100.0%            | ≥ 90.0%  |
| ≤ 4 sentences                   | 100.0%            | ≥ 90.0%  |
| Off-topic declined (≤ 50 words) | 100.0%            | ≥ 100.0% |
| No forbidden suggestion         | 100.0%            | ≥ 100.0% |
| No unbacked claim               | 100.0%            | ≥ 60.0%  |
| Names the expected answer       | 100.0%            | ≥ 90.0%  |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 48                       |
| Latency p50                                                           | 2.0s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 9.6s                     |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1428 · 217 · 111 · 0 · 0 |
| Cost / call                                                           | $0.0050                  |

**Total cost:** $0.24 over 48 calls.
