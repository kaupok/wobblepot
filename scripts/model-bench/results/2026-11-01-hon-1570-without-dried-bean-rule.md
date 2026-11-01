> HON-1570 removal run, not a production check: `src/lib/ai/recipe-prompt.ts` without the two dried-beans lines ("Dried beans and chickpeas are sold dry …" and its "250 g dried chickpeas" example). It shows the `en-dried-bean-chili` and `et-kuivatatud-oad` cases fail a gate without the rule. The prompt was restored afterwards.

# AI eval check: production configuration

2026-11-01 · 3 run(s) · tasks: recipe · 36 calls

Models: recipe `claude-sonnet-5-5`

## Result

**Fail.** 2 of 6 gates failed:

- **recipe · Ingredient recall:** 92.7% (92.3%–93.6%), needs ≥ 95.0%
- **recipe · Ingredient precision:** 92.7% (92.3%–93.6%), needs ≥ 95.0%

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task   | Gate                   | Observed            | Threshold                                                  | Result   |
| ------ | ---------------------- | ------------------- | ---------------------------------------------------------- | -------- |
| recipe | Ingredient recall      | 92.7% (92.3%–93.6%) | ≥ 95.0%                                                    | **fail** |
| recipe | Ingredient precision   | 92.7% (92.3%–93.6%) | ≥ 95.0%                                                    | **fail** |
| recipe | Quantity + unit exact  | 100.0%              | ≥ 100.0%                                                   | pass     |
| recipe | Confidence tier agrees | 100.0%              | ≥ 100.0%                                                   | pass     |
| recipe | Servings match         | 100.0%              | ≥ 100.0%                                                   | pass     |
| recipe | Max latency            | 15.6s               | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass     |

## recipe

| Metric                 | claude-sonnet-5-5   | Gate     |
| ---------------------- | ------------------- | -------- |
| Ingredient recall      | 92.7% (92.3%–93.6%) | ≥ 95.0%  |
| Ingredient precision   | 92.7% (92.3%–93.6%) | ≥ 95.0%  |
| Quantity + unit exact  | 100.0%              | ≥ 100.0% |
| Confidence tier agrees | 100.0%              | ≥ 100.0% |
| Step count delta       | 0.52 (0.45–0.55)    | —        |
| Servings match         | 100.0%              | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ |
| Calls                                                                 | 36                       |
| Latency p50                                                           | 4.8s                     |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 15.6s                    |
| Calls over budget                                                     | 0                        |
| Calls retried (latency includes retries)                              | 0                        |
| Errors                                                                | none                     |
| Truncated (`finishReason: length`)                                    | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 6318 · 818 · 117 · 0 · 0 |
| Cost / call                                                           | $0.0208                  |

**Total cost:** $0.75 over 36 calls.
