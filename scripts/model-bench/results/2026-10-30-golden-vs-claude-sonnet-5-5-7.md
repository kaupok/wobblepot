# Model benchmark: golden vs claude-sonnet-5-5

2026-10-30 · 3 run(s) · tasks: recipe · 30 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-28 at `3e4f1b50`, 3 run(s).

**Prompts since the golden:** recipe: prompt changed for 10 of 10 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **recipe · Quantity + unit exact:** 95.9% → 100.0% (+4.1 pp)

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **recipe · Step count delta:** 0.44 → 0.22 (0.11–0.44) (−0.22)

## recipe

| Metric                            | golden | claude-sonnet-5-5 | Delta   | Noise         |
| --------------------------------- | ------ | ----------------- | ------- | ------------- |
| Completed (no error, not cut off) | 100.0% | 100.0%            | ±0.0 pp | noise         |
| Ingredient recall                 | 100.0% | 100.0%            | ±0.0 pp | noise         |
| Ingredient precision              | 100.0% | 100.0%            | ±0.0 pp | noise         |
| Quantity + unit exact             | 95.9%  | 100.0%            | +4.1 pp | outside range |
| Confidence tier agrees            | 100.0% | 100.0%            | ±0.0 pp | noise         |
| Step count delta                  | 0.44   | 0.22 (0.11–0.44)  | −0.22   | noise         |
| Servings match                    | 100.0% | 100.0%            | ±0.0 pp | noise         |

| Operational                                                           | golden                  | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- | ----------------------- |
| Calls                                                                 | 30                      | 30                      |
| Latency p50                                                           | 4.8s                    | 4.6s                    |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 8.2s                    | 12.8s                   |
| Calls over budget                                                     | 0                       | 0                       |
| Calls retried (latency includes retries)                              | 0                       | 0                       |
| Errors                                                                | none                    | none                    |
| Truncated (`finishReason: length`)                                    | 0                       | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5451 · 709 · 20 · 0 · 0 | 6171 · 728 · 48 · 0 · 0 |
| Cost / call                                                           | $0.0180                 | $0.0196                 |

**Total cost:** $0.59 (claude-sonnet-5-5 $0.59 over 30 calls). The golden's $0.54 was spent when it was recorded.
