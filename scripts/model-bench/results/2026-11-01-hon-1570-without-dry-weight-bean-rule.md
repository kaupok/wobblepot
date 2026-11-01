> HON-1570 removal run, not a production check: `src/lib/ai/recipe-prompt.ts` with "mung, adzuki and soy beans" taken out of the as-bought weight line, the cooked × 0.4 line and the canned-cooked line. It shows the drained adzuki can in `en-dried-bean-chili` reads as 240 g, not 96 g, without the rule. The prompt was restored afterwards.

# AI eval check: production configuration

2026-11-01 · 3 run(s) · tasks: recipe · 36 calls

Models: recipe `claude-sonnet-5-5`

## Result

**Fail.** 1 of 6 gates failed:

- **recipe · Quantity + unit exact:** 98.7%, needs ≥ 100.0%

## Gates

Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to 80% of its route budget. A metric no case in this set measures passes as _not measured_.

| Task   | Gate                   | Observed | Threshold                                                  | Result   |
| ------ | ---------------------- | -------- | ---------------------------------------------------------- | -------- |
| recipe | Ingredient recall      | 100.0%   | ≥ 95.0%                                                    | pass     |
| recipe | Ingredient precision   | 100.0%   | ≥ 95.0%                                                    | pass     |
| recipe | Quantity + unit exact  | 98.7%    | ≥ 100.0%                                                   | **fail** |
| recipe | Confidence tier agrees | 100.0%   | ≥ 100.0%                                                   | pass     |
| recipe | Servings match         | 100.0%   | ≥ 100.0%                                                   | pass     |
| recipe | Max latency            | 10.6s    | ≤ 36.0s (80% of `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | pass     |

## recipe

| Metric                 | claude-sonnet-5-5 | Gate     |
| ---------------------- | ----------------- | -------- |
| Ingredient recall      | 100.0%            | ≥ 95.0%  |
| Ingredient precision   | 100.0%            | ≥ 95.0%  |
| Quantity + unit exact  | 98.7%             | ≥ 100.0% |
| Confidence tier agrees | 100.0%            | ≥ 100.0% |
| Step count delta       | 0.45              | —        |
| Servings match         | 100.0%            | ≥ 100.0% |

| Operational                                                           | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- |
| Calls                                                                 | 36                      |
| Latency p50                                                           | 4.5s                    |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 10.6s                   |
| Calls over budget                                                     | 0                       |
| Calls retried (latency includes retries)                              | 0                       |
| Errors                                                                | none                    |
| Truncated (`finishReason: length`)                                    | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 6382 · 747 · 63 · 0 · 0 |
| Cost / call                                                           | $0.0202                 |

**Total cost:** $0.73 over 36 calls.
