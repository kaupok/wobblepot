# AI eval check: production configuration

2026-10-30 · 3 run(s) · tasks: plan, imagine, tips, cook-question, adjust · 177 calls

Models: plan `claude-sonnet-5-5` · imagine `claude-sonnet-5-5` · tips `claude-sonnet-5-5` · cook-question `claude-sonnet-5-5` · adjust `claude-sonnet-5-5`

## Result

**Fail.** 2 of 36 gates failed:

- **cook-question · Answered without error:** 98.0% (94.1%–100.0%), needs ≥ 100.0%
- **cook-question · No forbidden suggestion:** 95.8% (87.5%–100.0%), needs ≥ 100.0%

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task          | Gate                                           | Observed             | Threshold                                     | Result   |
| ------------- | ---------------------------------------------- | -------------------- | --------------------------------------------- | -------- |
| plan          | First-try valid                                | 100.0%               | ≥ 100.0%                                      | pass     |
| plan          | Valid after repair                             | 100.0%               | ≥ 100.0%                                      | pass     |
| plan          | Structure valid                                | 100.0%               | ≥ 100.0%                                      | pass     |
| plan          | Out-of-pool meal IDs                           | 0.00                 | ≤ 0.00                                        | pass     |
| plan          | Max latency                                    | 9.8s                 | ≤ 32.0s (80% of `PLAN_AI_BUDGET_MS`)          | pass     |
| imagine       | All checks pass                                | 100.0%               | ≥ 100.0%                                      | pass     |
| imagine       | Exactly 3 meals                                | 100.0%               | ≥ 100.0%                                      | pass     |
| imagine       | Servings = household size                      | 100.0%               | ≥ 100.0%                                      | pass     |
| imagine       | ≥ 2 ingredients each                           | 100.0%               | ≥ 100.0%                                      | pass     |
| imagine       | No forbidden ingredient                        | 100.0%               | ≥ 100.0%                                      | pass     |
| imagine       | Max latency                                    | 24.9s                | ≤ 36.0s (80% of `IMAGINE_AI_BUDGET_MS`)       | pass     |
| tips          | Answered without error                         | 100.0%               | ≥ 100.0%                                      | pass     |
| tips          | Item counts in range                           | 96.7% (90.0%–100.0%) | ≥ 90.0%                                       | pass     |
| tips          | Follows the adjustment instruction             | 100.0%               | ≥ 80.0%                                       | pass     |
| tips          | Leaves out what the changed list doesn't have  | 100.0%               | ≥ 100.0%                                      | pass     |
| tips          | Keeps the notes' times and temperatures        | 100.0%               | ≥ 100.0%                                      | pass     |
| tips          | No step made from a note that is not a method  | 100.0%               | ≥ 100.0%                                      | pass     |
| tips          | Max latency                                    | 10.1s                | ≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`)         | pass     |
| cook-question | Answered without error                         | 98.0% (94.1%–100.0%) | ≥ 100.0%                                      | **fail** |
| cook-question | Metric units only                              | 100.0%               | ≥ 100.0%                                      | pass     |
| cook-question | ≤ 100 words                                    | 100.0%               | ≥ 90.0%                                       | pass     |
| cook-question | ≤ 4 sentences                                  | 100.0%               | ≥ 90.0%                                       | pass     |
| cook-question | Off-topic declined (≤ 50 words)                | 100.0%               | ≥ 100.0%                                      | pass     |
| cook-question | No forbidden suggestion                        | 95.8% (87.5%–100.0%) | ≥ 100.0%                                      | **fail** |
| cook-question | No unbacked claim                              | 100.0%               | ≥ 85.0%                                       | pass     |
| cook-question | Names the expected answer                      | 100.0%               | ≥ 90.0%                                       | pass     |
| cook-question | Leaves out what the changed list doesn't have  | 100.0%               | ≥ 100.0%                                      | pass     |
| cook-question | Max latency                                    | 12.6s                | ≤ 24.0s (80% of `COOK_QUESTION_AI_BUDGET_MS`) | pass     |
| adjust        | Answered without error                         | 100.0%               | ≥ 100.0%                                      | pass     |
| adjust        | Every original is a listed ingredient          | 100.0%               | ≥ 100.0%                                      | pass     |
| adjust        | Every replacement has an amount and a unit     | 100.0%               | ≥ 100.0%                                      | pass     |
| adjust        | Proposes the expected changes                  | 100.0%               | ≥ 90.0%                                       | pass     |
| adjust        | No change when none is needed                  | 100.0%               | ≥ 100.0%                                      | pass     |
| adjust        | Flags an instruction only the steps can follow | 100.0%               | ≥ 80.0%                                       | pass     |
| adjust        | No forbidden replacement                       | 100.0%               | ≥ 100.0%                                      | pass     |
| adjust        | Max latency                                    | 2.9s                 | ≤ 24.0s (80% of `ADJUST_AI_BUDGET_MS`)        | pass     |

## plan

| Metric                   | claude-sonnet-5-5 | Gate     |
| ------------------------ | ----------------- | -------- |
| First-try valid          | 100.0%            | ≥ 100.0% |
| Valid after repair       | 100.0%            | ≥ 100.0% |
| Structure valid          | 100.0%            | ≥ 100.0% |
| Out-of-pool meal IDs     | 0.00              | ≤ 0.00   |
| Distinct dinner proteins | 4.29 (4.13–4.38)  | —        |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 24                       |
| Latency p50                                                           | 5.7s                     |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 9.8s                     |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2673 · 882 · 573 · 0 · 0 |
| Cost / call                                                           | $0.0142                  |

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
| Latency p50                                                           | 18.0s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 24.9s                     |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3264 · 2771 · 901 · 0 · 0 |
| Cost / call                                                           | $0.0342                   |

## tips

| Metric                                        | claude-sonnet-5-5    | Gate     |
| --------------------------------------------- | -------------------- | -------- |
| Answered without error                        | 100.0%               | ≥ 100.0% |
| Item counts in range                          | 96.7% (90.0%–100.0%) | ≥ 90.0%  |
| Follows the adjustment instruction            | 100.0%               | ≥ 80.0%  |
| Leaves out what the changed list doesn't have | 100.0%               | ≥ 100.0% |
| Keeps the notes' times and temperatures       | 100.0%               | ≥ 100.0% |
| No step made from a note that is not a method | 100.0%               | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 30                       |
| Latency p50                                                           | 5.4s                     |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 10.1s                    |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2469 · 626 · 136 · 0 · 0 |
| Cost / call                                                           | $0.0112                  |

## cook-question

| Metric                                        | claude-sonnet-5-5    | Gate     |
| --------------------------------------------- | -------------------- | -------- |
| Answered without error                        | 98.0% (94.1%–100.0%) | ≥ 100.0% |
| Metric units only                             | 100.0%               | ≥ 100.0% |
| ≤ 100 words                                   | 100.0%               | ≥ 90.0%  |
| ≤ 4 sentences                                 | 100.0%               | ≥ 90.0%  |
| Off-topic declined (≤ 50 words)               | 100.0%               | ≥ 100.0% |
| No forbidden suggestion                       | 95.8% (87.5%–100.0%) | ≥ 100.0% |
| No unbacked claim                             | 100.0%               | ≥ 85.0%  |
| Names the expected answer                     | 100.0%               | ≥ 90.0%  |
| Leaves out what the changed list doesn't have | 100.0%               | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5             |
| --------------------------------------------------------------------- | ----------------------------- |
| Calls                                                                 | 51                            |
| Latency p50                                                           | 2.4s                          |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 12.6s                         |
| Calls over budget                                                     | 0                             |
| Calls retried (latency includes retries)                              | 0                             |
| Errors                                                                | AI_NoObjectGeneratedError × 1 |
| Truncated (`finishReason: length`)                                    | 1                             |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1510 · 236 · 126 · 0 · 0      |
| Cost / call                                                           | $0.0054                       |

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
| Latency p50                                                           | 1.8s                    |
| Latency max (budget 30.0s, `ADJUST_AI_BUDGET_MS`)                     | 2.9s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2057 · 102 · 15 · 0 · 0 |
| Cost / call                                                           | $0.0051                 |

**Total cost:** $2.45 over 177 calls.
