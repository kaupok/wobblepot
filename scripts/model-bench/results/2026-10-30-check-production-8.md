# AI eval check: production configuration

2026-10-30 · 3 run(s) · tasks: recipe · 30 calls

Models: recipe `claude-sonnet-5-5`

## Result

**Pass.** All 6 gates hold.

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task   | Gate                   | Observed             | Threshold                                                  | Result |
| ------ | ---------------------- | -------------------- | ---------------------------------------------------------- | ------ |
| recipe | Ingredient recall      | 98.9% (98.1%–100.0%) | ≥ 95.0%                                                    | pass   |
| recipe | Ingredient precision   | 98.9% (98.1%–100.0%) | ≥ 95.0%                                                    | pass   |
| recipe | Quantity + unit exact  | 100.0%               | ≥ 100.0%                                                   | pass   |
| recipe | Confidence tier agrees | 100.0%               | ≥ 100.0%                                                   | pass   |
| recipe | Servings match         | 100.0%               | ≥ 100.0%                                                   | pass   |
| recipe | Max latency            | 6.2s                 | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass   |

## recipe

| Metric                 | claude-sonnet-5-5    | Gate     |
| ---------------------- | -------------------- | -------- |
| Ingredient recall      | 98.9% (98.1%–100.0%) | ≥ 95.0%  |
| Ingredient precision   | 98.9% (98.1%–100.0%) | ≥ 95.0%  |
| Quantity + unit exact  | 100.0%               | ≥ 100.0% |
| Confidence tier agrees | 100.0%               | ≥ 100.0% |
| Step count delta       | 0.37 (0.33–0.44)     | —        |
| Servings match         | 100.0%               | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- |
| Calls                                                                 | 30                     |
| Latency p50                                                           | 4.6s                   |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 6.2s                   |
| Calls over budget                                                     | 0                      |
| Calls retried (latency includes retries)                              | 0                      |
| Errors                                                                | none                   |
| Truncated (`finishReason: length`)                                    | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 6120 · 684 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0191                |

**Total cost:** $0.57 over 30 calls.
