# AI eval check: production configuration

2026-10-19 · 3 run(s) · tasks: tips · 30 calls

Models: tips `claude-sonnet-5-5`

## Result

**Pass.** All 7 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task | Gate                                          | Observed | Threshold                             | Result |
| ---- | --------------------------------------------- | -------- | ------------------------------------- | ------ |
| tips | Answered without error                        | 100.0%   | ≥ 100.0%                              | pass   |
| tips | Item counts in range                          | 100.0%   | ≥ 90.0%                               | pass   |
| tips | Follows the adjustment instruction            | 100.0%   | ≥ 80.0%                               | pass   |
| tips | Leaves out what the changed list doesn't have | 100.0%   | ≥ 100.0%                              | pass   |
| tips | Keeps the notes' times and temperatures       | 100.0%   | ≥ 100.0%                              | pass   |
| tips | No step made from a note that is not a method | 100.0%   | ≥ 100.0%                              | pass   |
| tips | Max latency                                   | 9.9s     | ≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`) | pass   |

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
| Latency p50                                                           | 6.5s                     |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 9.9s                     |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2469 · 639 · 151 · 0 · 0 |
| Cost / call                                                           | $0.0113                  |

**Total cost:** $0.34 over 30 calls.
