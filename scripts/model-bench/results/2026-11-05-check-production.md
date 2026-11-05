# AI eval check: production configuration

2026-11-05 · 3 run(s) · tasks: tips · 30 calls

Models: tips `claude-sonnet-5-5`

## Result

**Fail.** 1 of 7 gates failed:

- **tips · Keeps the notes' times and temperatures:** 77.8% (66.7%–100.0%), needs ≥ 100.0%

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task | Gate                                          | Observed             | Threshold                             | Result   |
| ---- | --------------------------------------------- | -------------------- | ------------------------------------- | -------- |
| tips | Answered without error                        | 100.0%               | ≥ 100.0%                              | pass     |
| tips | Item counts in range                          | 100.0%               | ≥ 90.0%                               | pass     |
| tips | Follows the adjustment instruction            | 100.0%               | ≥ 80.0%                               | pass     |
| tips | Leaves out what the changed list doesn't have | 100.0%               | ≥ 100.0%                              | pass     |
| tips | Keeps the notes' times and temperatures       | 77.8% (66.7%–100.0%) | ≥ 100.0%                              | **fail** |
| tips | No step made from a note that is not a method | 100.0%               | ≥ 100.0%                              | pass     |
| tips | Max latency                                   | 10.8s                | ≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`) | pass     |

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
| Latency p50                                                           | 5.2s                       |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 10.8s                      |
| Calls over budget                                                     | 0                          |
| Calls retried (latency includes retries)                              | 0                          |
| Errors                                                                | none                       |
| Truncated (`finishReason: length`)                                    | 0                          |
| Tokens / call (input · output · reasoning · cache read · cache write) | 4 · 617 · 139 · 1643 · 822 |
| Cost / call                                                           | $0.0086                    |

**Total cost:** $0.26 over 30 calls.
