# AI eval check: production configuration

2026-10-30 · 3 run(s) · tasks: plan, imagine, tips, adjust · 126 calls

Models: plan `claude-sonnet-5-5` · imagine `claude-sonnet-5-5` · tips `claude-sonnet-5-5` · adjust `claude-sonnet-5-5`

## Result

**Pass.** All 26 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task    | Gate                                           | Observed | Threshold                               | Result |
| ------- | ---------------------------------------------- | -------- | --------------------------------------- | ------ |
| plan    | First-try valid                                | 100.0%   | ≥ 100.0%                                | pass   |
| plan    | Valid after repair                             | 100.0%   | ≥ 100.0%                                | pass   |
| plan    | Structure valid                                | 100.0%   | ≥ 100.0%                                | pass   |
| plan    | Out-of-pool meal IDs                           | 0.00     | ≤ 0.00                                  | pass   |
| plan    | Max latency                                    | 9.2s     | ≤ 32.0s (80% of `PLAN_AI_BUDGET_MS`)    | pass   |
| imagine | All checks pass                                | 100.0%   | ≥ 100.0%                                | pass   |
| imagine | Exactly 3 meals                                | 100.0%   | ≥ 100.0%                                | pass   |
| imagine | Servings = household size                      | 100.0%   | ≥ 100.0%                                | pass   |
| imagine | ≥ 2 ingredients each                           | 100.0%   | ≥ 100.0%                                | pass   |
| imagine | No forbidden ingredient                        | 100.0%   | ≥ 100.0%                                | pass   |
| imagine | Max latency                                    | 24.3s    | ≤ 36.0s (80% of `IMAGINE_AI_BUDGET_MS`) | pass   |
| tips    | Answered without error                         | 100.0%   | ≥ 100.0%                                | pass   |
| tips    | Item counts in range                           | 100.0%   | ≥ 90.0%                                 | pass   |
| tips    | Follows the adjustment instruction             | 100.0%   | ≥ 80.0%                                 | pass   |
| tips    | Leaves out what the changed list doesn't have  | 100.0%   | ≥ 100.0%                                | pass   |
| tips    | Keeps the notes' times and temperatures        | 100.0%   | ≥ 100.0%                                | pass   |
| tips    | No step made from a note that is not a method  | 100.0%   | ≥ 100.0%                                | pass   |
| tips    | Max latency                                    | 11.4s    | ≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`)   | pass   |
| adjust  | Answered without error                         | 100.0%   | ≥ 100.0%                                | pass   |
| adjust  | Every original is a listed ingredient          | 100.0%   | ≥ 100.0%                                | pass   |
| adjust  | Every replacement has an amount and a unit     | 100.0%   | ≥ 100.0%                                | pass   |
| adjust  | Proposes the expected changes                  | 100.0%   | ≥ 90.0%                                 | pass   |
| adjust  | No change when none is needed                  | 100.0%   | ≥ 100.0%                                | pass   |
| adjust  | Flags an instruction only the steps can follow | 100.0%   | ≥ 80.0%                                 | pass   |
| adjust  | No forbidden replacement                       | 100.0%   | ≥ 100.0%                                | pass   |
| adjust  | Max latency                                    | 3.0s     | ≤ 24.0s (80% of `ADJUST_AI_BUDGET_MS`)  | pass   |

## plan

| Metric                   | claude-sonnet-5-5 | Gate     |
| ------------------------ | ----------------- | -------- |
| First-try valid          | 100.0%            | ≥ 100.0% |
| Valid after repair       | 100.0%            | ≥ 100.0% |
| Structure valid          | 100.0%            | ≥ 100.0% |
| Out-of-pool meal IDs     | 0.00              | ≤ 0.00   |
| Distinct dinner proteins | 4.42 (4.38–4.50)  | —        |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 24                       |
| Latency p50                                                           | 5.7s                     |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 9.2s                     |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2673 · 867 · 559 · 0 · 0 |
| Cost / call                                                           | $0.0140                  |

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
| Latency p50                                                           | 18.3s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 24.3s                     |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3264 · 2719 · 862 · 0 · 0 |
| Cost / call                                                           | $0.0337                   |

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
| Latency p50                                                           | 4.9s                     |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 11.4s                    |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2469 · 604 · 121 · 0 · 0 |
| Cost / call                                                           | $0.0110                  |

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
| Latency p50                                                           | 1.7s                    |
| Latency max (budget 30.0s, `ADJUST_AI_BUDGET_MS`)                     | 3.0s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2057 · 103 · 16 · 0 · 0 |
| Cost / call                                                           | $0.0051                 |

**Total cost:** $2.15 over 126 calls.
