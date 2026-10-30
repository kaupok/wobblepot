# Model benchmark: golden vs claude-sonnet-5-5

2026-10-30 · 3 run(s) · tasks: recipe · 30 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-28 at `3e4f1b50`, 3 run(s).

**Prompts since the golden:** recipe: prompt changed for 10 of 10 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **recipe · Quantity + unit exact:** 95.9% → 100.0% (+4.1 pp)
- **recipe · Reasoning:** the baseline reasons (20 tokens/call), the candidate does not; latency and cost deltas on this task include that

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **recipe · Ingredient recall:** 100.0% → 99.5% (98.6%–100.0%) (−0.5 pp)
- **recipe · Ingredient precision:** 100.0% → 99.5% (98.6%–100.0%) (−0.5 pp)
- **recipe · Step count delta:** 0.44 → 0.37 (0.33–0.44) (−0.07)

## recipe

| Metric                            | golden | claude-sonnet-5-5    | Delta   | Noise         |
| --------------------------------- | ------ | -------------------- | ------- | ------------- |
| Completed (no error, not cut off) | 100.0% | 100.0%               | ±0.0 pp | noise         |
| Ingredient recall                 | 100.0% | 99.5% (98.6%–100.0%) | −0.5 pp | noise         |
| Ingredient precision              | 100.0% | 99.5% (98.6%–100.0%) | −0.5 pp | noise         |
| Quantity + unit exact             | 95.9%  | 100.0%               | +4.1 pp | outside range |
| Confidence tier agrees            | 100.0% | 100.0%               | ±0.0 pp | noise         |
| Step count delta                  | 0.44   | 0.37 (0.33–0.44)     | −0.07   | noise         |
| Servings match                    | 100.0% | 100.0%               | ±0.0 pp | noise         |

| Operational                                                           | golden                  | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ----------------------- | ---------------------- |
| Calls                                                                 | 30                      | 30                     |
| Latency p50                                                           | 4.8s                    | 4.7s                   |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 8.2s                    | 9.0s                   |
| Calls over budget                                                     | 0                       | 0                      |
| Calls retried (latency includes retries)                              | 0                       | 0                      |
| Errors                                                                | none                    | none                   |
| Truncated (`finishReason: length`)                                    | 0                       | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5451 · 709 · 20 · 0 · 0 | 6120 · 683 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0180                 | $0.0191                |

**Total cost:** $0.57 (claude-sonnet-5-5 $0.57 over 30 calls). The golden's $0.54 was spent when it was recorded.
