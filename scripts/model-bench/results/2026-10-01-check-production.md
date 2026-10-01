# AI eval check: production configuration

2026-10-01 · 3 run(s) · tasks: plan, recipe, imagine, review, tips · 123 calls

Models: plan `claude-sonnet-5-5` · recipe `claude-sonnet-5-5` · imagine `claude-sonnet-5-5` · review `claude-sonnet-5-5` · tips `claude-sonnet-5-5`

## Result

**Pass.** All 22 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task    | Gate                           | Observed             | Threshold                                                  | Result |
| ------- | ------------------------------ | -------------------- | ---------------------------------------------------------- | ------ |
| plan    | First-try valid                | 100.0%               | ≥ 100.0%                                                   | pass   |
| plan    | Valid after repair             | 100.0%               | ≥ 100.0%                                                   | pass   |
| plan    | Structure valid                | 100.0%               | ≥ 100.0%                                                   | pass   |
| plan    | Out-of-pool meal IDs           | 0.00                 | ≤ 0.00                                                     | pass   |
| plan    | Max latency                    | 8.8s                 | ≤ 32.0s (80% of `PLAN_AI_BUDGET_MS`)                       | pass   |
| recipe  | Ingredient recall              | 99.4% (98.2%–100.0%) | ≥ 95.0%                                                    | pass   |
| recipe  | Ingredient precision           | 99.4% (98.2%–100.0%) | ≥ 95.0%                                                    | pass   |
| recipe  | Quantity + unit exact          | 100.0%               | ≥ 100.0%                                                   | pass   |
| recipe  | Confidence tier agrees         | 100.0%               | ≥ 100.0%                                                   | pass   |
| recipe  | Max latency                    | 15.5s                | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass   |
| imagine | All checks pass                | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | Exactly 3 meals                | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | Servings = household size      | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | ≥ 2 ingredients each           | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | No forbidden ingredient        | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | Max latency                    | 25.8s                | ≤ 36.0s (80% of `IMAGINE_AI_BUDGET_MS`)                    | pass   |
| review  | Every ID exactly once          | 100.0%               | ≥ 100.0%                                                   | pass   |
| review  | Seeded errors corrected (±25%) | 80.0%                | ≥ 70.0%                                                    | pass   |
| review  | Correct quantities kept        | 93.8% (88.5%–97.9%)  | ≥ 85.0%                                                    | pass   |
| review  | Max latency                    | 5.8s                 | ≤ 36.0s (80% of `REVIEW_AI_BUDGET_MS`)                     | pass   |
| tips    | Item counts in range           | 100.0%               | ≥ 100.0%                                                   | pass   |
| tips    | Max latency                    | 10.2s                | ≤ 36.0s (80% of `TIPS_AI_BUDGET_MS`)                       | pass   |

## plan

| Metric                   | claude-sonnet-5-5 | Gate     |
| ------------------------ | ----------------- | -------- |
| First-try valid          | 100.0%            | ≥ 100.0% |
| Valid after repair       | 100.0%            | ≥ 100.0% |
| Structure valid          | 100.0%            | ≥ 100.0% |
| Out-of-pool meal IDs     | 0.00              | ≤ 0.00   |
| Distinct dinner proteins | 4.25 (4.13–4.38)  | —        |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 24                       |
| Latency p50                                                           | 5.7s                     |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 8.8s                     |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2673 · 839 · 530 · 0 · 0 |
| Cost / call                                                           | $0.0137                  |

## recipe

| Metric                 | claude-sonnet-5-5    | Gate     |
| ---------------------- | -------------------- | -------- |
| Ingredient recall      | 99.4% (98.2%–100.0%) | ≥ 95.0%  |
| Ingredient precision   | 99.4% (98.2%–100.0%) | ≥ 95.0%  |
| Quantity + unit exact  | 100.0%               | ≥ 100.0% |
| Confidence tier agrees | 100.0%               | ≥ 100.0% |
| Step count delta       | 0.38 (0.13–0.50)     | —        |

| Operational                                                           | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- |
| Calls                                                                 | 27                     |
| Latency p50                                                           | 5.1s                   |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 15.5s                  |
| Calls over budget                                                     | 0                      |
| Calls retried (latency includes retries)                              | 0                      |
| Errors                                                                | none                   |
| Truncated (`finishReason: length`)                                    | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5259 · 710 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0176                |

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
| Latency p50                                                           | 19.1s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 25.8s                     |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3081 · 2831 · 925 · 0 · 0 |
| Cost / call                                                           | $0.0345                   |

## review

| Metric                         | claude-sonnet-5-5   | Gate     |
| ------------------------------ | ------------------- | -------- |
| Every ID exactly once          | 100.0%              | ≥ 100.0% |
| Seeded errors corrected (±25%) | 80.0%               | ≥ 70.0%  |
| Correct quantities kept        | 93.8% (88.5%–97.9%) | ≥ 85.0%  |

| Operational                                                           | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- |
| Calls                                                                 | 24                     |
| Latency p50                                                           | 1.8s                   |
| Latency max (budget 45.0s, `REVIEW_AI_BUDGET_MS`)                     | 5.8s                   |
| Calls over budget                                                     | 0                      |
| Calls retried (latency includes retries)                              | 0                      |
| Errors                                                                | none                   |
| Truncated (`finishReason: length`)                                    | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1257 · 173 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0042                |

## tips

| Metric               | claude-sonnet-5-5 | Gate     |
| -------------------- | ----------------- | -------- |
| Item counts in range | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- |
| Calls                                                                 | 24                     |
| Latency p50                                                           | 5.4s                   |
| Latency max (budget 45.0s, `TIPS_AI_BUDGET_MS`)                       | 10.2s                  |
| Calls over budget                                                     | 0                      |
| Calls retried (latency includes retries)                              | 0                      |
| Errors                                                                | none                   |
| Truncated (`finishReason: length`)                                    | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1293 · 494 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0075                |

**Total cost:** $1.92 over 123 calls.
