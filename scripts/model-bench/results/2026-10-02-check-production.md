# AI eval check: production configuration

2026-10-02 · 3 run(s) · tasks: tips · 24 calls

Models: tips `claude-sonnet-5-5`

## Result

**Pass.** All 3 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task | Gate                   | Observed | Threshold                            | Result |
| ---- | ---------------------- | -------- | ------------------------------------ | ------ |
| tips | Answered without error | 100.0%   | ≥ 100.0%                             | pass   |
| tips | Item counts in range   | 100.0%   | ≥ 90.0%                              | pass   |
| tips | Max latency            | 9.4s     | ≤ 36.0s (80% of `TIPS_AI_BUDGET_MS`) | pass   |

## tips

| Metric                 | claude-sonnet-5-5 | Gate     |
| ---------------------- | ----------------- | -------- |
| Answered without error | 100.0%            | ≥ 100.0% |
| Item counts in range   | 100.0%            | ≥ 90.0%  |

| Operational                                                           | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- |
| Calls                                                                 | 24                     |
| Latency p50                                                           | 4.5s                   |
| Latency max (budget 45.0s, `TIPS_AI_BUDGET_MS`)                       | 9.4s                   |
| Calls over budget                                                     | 0                      |
| Calls retried (latency includes retries)                              | 0                      |
| Errors                                                                | none                   |
| Truncated (`finishReason: length`)                                    | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1767 · 388 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0074                |

**Total cost:** $0.18 over 24 calls.
