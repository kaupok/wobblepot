# AI eval check: production configuration

2026-11-01 · 3 run(s) · tasks: recipe, imagine · 69 calls

Models: recipe `claude-sonnet-5-5` · imagine `claude-sonnet-5-5`

## Result

**Pass.** All 12 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task    | Gate                      | Observed             | Threshold                                                  | Result |
| ------- | ------------------------- | -------------------- | ---------------------------------------------------------- | ------ |
| recipe  | Ingredient recall         | 99.5% (98.4%–100.0%) | ≥ 95.0%                                                    | pass   |
| recipe  | Ingredient precision      | 99.5% (98.4%–100.0%) | ≥ 95.0%                                                    | pass   |
| recipe  | Quantity + unit exact     | 100.0%               | ≥ 100.0%                                                   | pass   |
| recipe  | Confidence tier agrees    | 100.0%               | ≥ 100.0%                                                   | pass   |
| recipe  | Servings match            | 100.0%               | ≥ 100.0%                                                   | pass   |
| recipe  | Max latency               | 8.3s                 | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass   |
| imagine | All checks pass           | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | Exactly 3 meals           | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | Servings = household size | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | ≥ 2 ingredients each      | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | No forbidden ingredient   | 100.0%               | ≥ 100.0%                                                   | pass   |
| imagine | Max latency               | 24.0s                | ≤ 36.0s (80% of `IMAGINE_AI_BUDGET_MS`)                    | pass   |

## recipe

| Metric                 | claude-sonnet-5-5    | Gate     |
| ---------------------- | -------------------- | -------- |
| Ingredient recall      | 99.5% (98.4%–100.0%) | ≥ 95.0%  |
| Ingredient precision   | 99.5% (98.4%–100.0%) | ≥ 95.0%  |
| Quantity + unit exact  | 100.0%               | ≥ 100.0% |
| Confidence tier agrees | 100.0%               | ≥ 100.0% |
| Step count delta       | 0.44                 | —        |
| Servings match         | 100.0%               | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- |
| Calls                                                                 | 30                      |
| Latency p50                                                           | 4.5s                    |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 8.3s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 6414 · 709 · 22 · 0 · 0 |
| Cost / call                                                           | $0.0199                 |

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
| Latency p50                                                           | 18.9s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 24.0s                     |
| Calls over budget                                                     | 0                         |
| Calls retried (latency includes retries)                              | 0                         |
| Errors                                                                | none                      |
| Truncated (`finishReason: length`)                                    | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3502 · 2725 · 853 · 0 · 0 |
| Cost / call                                                           | $0.0342                   |

**Total cost:** $1.93 over 69 calls.
