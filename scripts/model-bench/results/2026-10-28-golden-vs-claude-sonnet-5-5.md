# Model benchmark: golden vs claude-sonnet-5-5

2026-10-28 · 3 run(s) · tasks: recipe · 27 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-07 at `27cf478d`, 3 run(s).

**Prompts since the golden:** recipe: prompt changed for 9 of 9 cases.

## Not in golden

These cases are in the case set but not in the golden, so they have no baseline and were not run: re-record to include them (`pnpm ai-eval --record`).

- `recipe/en-no-servings-household-of-2` — re-record to include it

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **recipe · Step count delta:** 0.08 (0.00–0.13) → 0.46 (0.38–0.50) (+0.38)

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Judge

**Pending.** 0 pair(s), 0 prompt(s), are exported to the `.judge-pairs.json` beside this report for judging in Claude Code. Run `/bench-judge`, which answers them and imports the verdicts here (`pnpm ai-eval --import-verdicts <that>.judge-verdicts.json`).

## recipe

| Metric                            | golden           | claude-sonnet-5-5 | Delta   | Noise         |
| --------------------------------- | ---------------- | ----------------- | ------- | ------------- |
| Completed (no error, not cut off) | 100.0%           | 100.0%            | ±0.0 pp | noise         |
| Ingredient recall                 | 100.0%           | 100.0%            | ±0.0 pp | noise         |
| Ingredient precision              | 100.0%           | 100.0%            | ±0.0 pp | noise         |
| Quantity + unit exact             | 100.0%           | 100.0%            | ±0.0 pp | noise         |
| Confidence tier agrees            | 100.0%           | 100.0%            | ±0.0 pp | noise         |
| Step count delta                  | 0.08 (0.00–0.13) | 0.46 (0.38–0.50)  | +0.38   | outside range |
| Servings match                    | —                | —                 | —       | —             |

| Operational                                                           | golden                 | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Calls                                                                 | 27                     | 27                     |
| Latency p50                                                           | 4.9s                   | 5.0s                   |
| Latency max (budget 45.0s, `RECIPE_PARSE_AI_BUDGET_MS (pasted text)`) | 5.9s                   | 5.7s                   |
| Calls over budget                                                     | 0                      | 0                      |
| Calls retried (latency includes retries)                              | 0                      | 0                      |
| Errors                                                                | none                   | none                   |
| Truncated (`finishReason: length`)                                    | 0                      | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 5504 · 702 · 0 · 0 · 0 | 5504 · 711 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0180                | $0.0181                |

**Total cost:** $0.49 (claude-sonnet-5-5 $0.49 over 27 calls). The golden's $0.49 was spent when it was recorded.
