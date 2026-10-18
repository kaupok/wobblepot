# AI eval check: production configuration

2026-10-19 · 3 run(s) · tasks: adjust · 27 calls

Models: adjust `claude-sonnet-5-5`

## Result

**Pass.** All 7 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task   | Gate                                       | Observed | Threshold                              | Result |
| ------ | ------------------------------------------ | -------- | -------------------------------------- | ------ |
| adjust | Answered without error                     | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Every original is a listed ingredient      | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Every replacement has an amount and a unit | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Proposes the expected changes              | 100.0%   | ≥ 90.0%                                | pass   |
| adjust | No change when none is needed              | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | No forbidden replacement                   | 100.0%   | ≥ 100.0%                               | pass   |
| adjust | Max latency                                | 3.4s     | ≤ 24.0s (80% of `ADJUST_AI_BUDGET_MS`) | pass   |

## adjust

| Metric                                     | claude-sonnet-5-5 | Gate     |
| ------------------------------------------ | ----------------- | -------- |
| Answered without error                     | 100.0%            | ≥ 100.0% |
| Every original is a listed ingredient      | 100.0%            | ≥ 100.0% |
| Every replacement has an amount and a unit | 100.0%            | ≥ 100.0% |
| Proposes the expected changes              | 100.0%            | ≥ 90.0%  |
| No change when none is needed              | 100.0%            | ≥ 100.0% |
| No forbidden replacement                   | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- |
| Calls                                                                 | 27                      |
| Latency p50                                                           | 1.8s                    |
| Latency max (budget 30.0s, `ADJUST_AI_BUDGET_MS`)                     | 3.4s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1874 · 109 · 14 · 0 · 0 |
| Cost / call                                                           | $0.0048                 |

**Total cost:** $0.13 over 27 calls.
