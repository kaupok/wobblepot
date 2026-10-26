# Model benchmark: golden vs claude-sonnet-5-5

2026-10-26 · 3 run(s) · tasks: plan · 24 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s).

**Prompts since the golden:** plan: prompt changed for 6 of 8 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

None.

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

- **plan · Distinct dinner proteins:** 4.25 (4.13–4.38) → 4.33 (4.25–4.38) (+0.08)

## Judge

**Pending.** 0 pair(s), 0 prompt(s), are exported to the `.judge-pairs.json` beside this report for judging in Claude Code. Run `/bench-judge`, which answers them and imports the verdicts here (`pnpm ai-eval --import-verdicts <that>.judge-verdicts.json`).

## plan

| Metric                            | golden           | claude-sonnet-5-5 | Delta   | Noise |
| --------------------------------- | ---------------- | ----------------- | ------- | ----- |
| Completed (no error, not cut off) | 100.0%           | 100.0%            | ±0.0 pp | noise |
| First-try valid                   | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Valid after repair                | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Structure valid                   | 100.0%           | 100.0%            | ±0.0 pp | noise |
| Out-of-pool meal IDs              | 0.00             | 0.00              | ±0.00   | noise |
| Distinct dinner proteins          | 4.25 (4.13–4.38) | 4.33 (4.25–4.38)  | +0.08   | noise |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 24                       | 24                       |
| Latency p50                                                           | 5.7s                     | 6.2s                     |
| Latency max (budget 40.0s, `PLAN_AI_BUDGET_MS`)                       | 8.8s                     | 11.6s                    |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2673 · 839 · 530 · 0 · 0 | 2673 · 843 · 534 · 0 · 0 |
| Cost / call                                                           | $0.0137                  | $0.0138                  |

**Total cost:** $0.33 (claude-sonnet-5-5 $0.33 over 24 calls). The golden's $0.33 was spent when it was recorded.
