# Model benchmark: golden vs claude-sonnet-5-5

2026-11-10 · 3 run(s) · tasks: tips · 30 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-30 at `d3c0ef98`, 3 run(s).

**Prompts since the golden:** tips: prompt changed for 4 of 10 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

None.

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Judge

Counts are for claude-sonnet-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task | Wins | Ties | Losses | Skipped | Judge errors | Win rate                     |
| ---- | ---- | ---- | ------ | ------- | ------------ | ---------------------------- |
| tips | 13   | 5    | 12     | 0       | 0            | 52.0% (13 won of 25 decided) |

## tips

| Metric                                        | golden | claude-sonnet-5-5 | Delta   | Noise |
| --------------------------------------------- | ------ | ----------------- | ------- | ----- |
| Completed (no error, not cut off)             | 100.0% | 100.0%            | ±0.0 pp | noise |
| Answered without error                        | 100.0% | 100.0%            | ±0.0 pp | noise |
| Item counts in range                          | 100.0% | 100.0%            | ±0.0 pp | noise |
| Follows the adjustment instruction            | 100.0% | 100.0%            | ±0.0 pp | noise |
| Leaves out what the changed list doesn't have | 100.0% | 100.0%            | ±0.0 pp | noise |
| Keeps the notes' times and temperatures       | 100.0% | 100.0%            | ±0.0 pp | noise |
| No step made from a note that is not a method | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                   | claude-sonnet-5-5          |
| --------------------------------------------------------------------- | ------------------------ | -------------------------- |
| Calls                                                                 | 30                       | 30                         |
| Latency p50                                                           | 4.9s                     | 6.4s                       |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 11.4s                    | 10.8s                      |
| Calls over budget                                                     | 0                        | 0                          |
| Calls retried (latency includes retries)                              | 0                        | 0                          |
| Errors                                                                | none                     | none                       |
| Truncated (`finishReason: length`)                                    | 0                        | 0                          |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2469 · 604 · 121 · 0 · 0 | 4 · 717 · 232 · 1660 · 830 |
| Cost / call                                                           | $0.0110                  | $0.0096                    |

**Total cost:** $0.29 (claude-sonnet-5-5 $0.29 over 30 calls, judge claude-code/opus $0.0000 over 60 calls). The golden's $0.33 was spent when it was recorded.
