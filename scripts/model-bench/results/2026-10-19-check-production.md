# AI eval check: production configuration

2026-10-19 · 3 run(s) · tasks: tips, adjust · 63 calls

Models: tips `claude-sonnet-5-5` · adjust `claude-sonnet-5-5`

## Result

**Pass.** All 12 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task   | Gate                                           | Observed | Threshold                              | Result |
| ------ | ---------------------------------------------- | -------- | -------------------------------------- | ------ |
| tips   | Answered without error                         | 100.0%   | ≥ 100.0%                               | pass   |
| tips   | Item counts in range                           | 100.0%   | ≥ 90.0%                                | pass   |
| tips   | Follows the adjustment instruction             | 100.0%   | ≥ 80.0%                                | pass   |
| tips   | Max latency                                    | 9.0s     | ≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`)  | pass   |
| adjust | Answered without error                         | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Every original is a listed ingredient          | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Every replacement has an amount and a unit     | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Proposes the expected changes                  | 100.0%   | ≥ 90.0%                                | pass   |
| adjust | No change when none is needed                  | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Flags an instruction only the steps can follow | 100.0%   | ≥ 80.0%                                | pass   |
| adjust | No forbidden replacement                       | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Max latency                                    | 2.9s     | ≤ 24.0s (80% of `ADJUST_AI_BUDGET_MS`) | pass   |

## tips

| Metric                             | claude-sonnet-5-5 | Gate     |
| ---------------------------------- | ----------------- | -------- |
| Answered without error             | 100.0%            | ≥ 100.0% |
| Item counts in range               | 100.0%            | ≥ 90.0%  |
| Follows the adjustment instruction | 100.0%            | ≥ 80.0%  |

| Operational                                                           | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- |
| Calls                                                                 | 30                     |
| Latency p50                                                           | 4.4s                   |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 9.0s                   |
| Calls over budget                                                     | 0                      |
| Calls retried (latency includes retries)                              | 0                      |
| Errors                                                                | none                   |
| Truncated (`finishReason: length`)                                    | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2196 · 428 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0087                |

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
| Latency p50                                                           | 2.0s                    |
| Latency max (budget 30.0s, `ADJUST_AI_BUDGET_MS`)                     | 2.9s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2058 · 100 · 13 · 0 · 0 |
| Cost / call                                                           | $0.0051                 |

**Total cost:** $0.43 over 63 calls.
