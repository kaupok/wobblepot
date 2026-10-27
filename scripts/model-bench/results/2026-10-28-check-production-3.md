# AI eval check: production configuration

2026-10-28 · 3 run(s) · tasks: recipe · 30 calls

Models: recipe `claude-sonnet-5-5`

## Result

**Pass.** All 6 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task   | Gate                   | Observed | Threshold                                                  | Result |
| ------ | ---------------------- | -------- | ---------------------------------------------------------- | ------ |
| recipe | Ingredient recall      | 100.0%   | ≥ 95.0%                                                    | pass   |
| recipe | Ingredient precision   | 100.0%   | ≥ 95.0%                                                    | pass   |
| recipe | Quantity + unit exact  | 100.0%   | ≥ 100.0%                                                   | pass   |
| recipe | Confidence tier agrees | 100.0%   | ≥ 100.0%                                                   | pass   |
| recipe | Servings match         | 100.0%   | ≥ 100.0%                                                   | pass   |
| recipe | Max latency            | 8.2s     | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass   |

## recipe

| Metric                 | claude-sonnet-5-5 | Gate     |
| ---------------------- | ----------------- | -------- |
| Ingredient recall      | 100.0%            | ≥ 95.0%  |
| Ingredient precision   | 100.0%            | ≥ 95.0%  |
| Quantity + unit exact  | 100.0%            | ≥ 100.0% |
| Confidence tier agrees | 100.0%            | ≥ 100.0% |
| Step count delta       | 0.44              | —        |
| Servings match         | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- |
| Calls                                                                 | 30                      |
| Latency p50                                                           | 4.8s                    |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 8.2s                    |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5451 · 709 · 20 · 0 · 0 |
| Cost / call                                                           | $0.0180                 |

**Total cost:** $0.54 over 30 calls.
