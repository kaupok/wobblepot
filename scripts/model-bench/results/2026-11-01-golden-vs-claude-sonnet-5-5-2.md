# Model benchmark: golden vs claude-sonnet-5-5

2026-11-01 · 3 run(s) · tasks: recipe · 30 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-11-01 at `151e81f8`, 3 run(s).

**Prompts since the golden:** recipe: prompt changed for 10 of 10 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

None.

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **recipe · Ingredient recall:** 98.9% (98.4%–100.0%) → 100.0% (+1.1 pp)
- **recipe · Ingredient precision:** 98.9% (98.4%–100.0%) → 100.0% (+1.1 pp)

## Judge

**Pending.** 0 pair(s), 0 prompt(s), are exported to the `.judge-pairs.json` beside this report for judging in Claude Code. Run `/bench-judge`, which answers them and imports the verdicts here (`pnpm ai-eval --import-verdicts <that>.judge-verdicts.json`).

## recipe

| Metric                            | golden               | claude-sonnet-5-5 | Delta   | Noise |
| --------------------------------- | -------------------- | ----------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0%               | 100.0%            | ±0.0 pp | noise |
| Ingredient recall                 | 98.9% (98.4%–100.0%) | 100.0%            | +1.1 pp | noise |
| Ingredient precision              | 98.9% (98.4%–100.0%) | 100.0%            | +1.1 pp | noise |
| Quantity + unit exact             | 100.0%               | 100.0%            | ±0.0 pp | noise |
| Confidence tier agrees            | 100.0%               | 100.0%            | ±0.0 pp | noise |
| Step count delta                  | 0.41 (0.33–0.44)     | 0.41 (0.33–0.44)  | ±0.00   | noise |
| Servings match                    | 100.0%               | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                  | claude-sonnet-5-5       |
| --------------------------------------------------------------------- | ----------------------- | ----------------------- |
| Calls                                                                 | 30                      | 30                      |
| Latency p50                                                           | 4.5s                    | 4.5s                    |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 7.9s                    | 8.8s                    |
| Calls over budget                                                     | 0                       | 0                       |
| Calls retried (latency includes retries)                              | 0                       | 0                       |
| Errors                                                                | none                    | none                    |
| Truncated (`finishReason: length`)                                    | 0                       | 0                       |
| Tokens / call (input · output · reasoning · cache read · cache write) | 6286 · 735 · 45 · 0 · 0 | 6332 · 743 · 52 · 0 · 0 |
| Cost / call                                                           | $0.0199                 | $0.0201                 |

**Total cost:** $0.60 (claude-sonnet-5-5 $0.60 over 30 calls). The golden's $0.60 was spent when it was recorded.
