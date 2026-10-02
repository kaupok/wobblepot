# Model benchmark: golden vs claude-sonnet-5-5

2026-10-02 · 3 run(s) · tasks: tips · 24 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s).

**Prompts since the golden:** tips: prompt changed for 5 of 8 cases.

## Regressions

- **tips · Judge win rate:** 35.3% (6 won of 17 decided) is under 40%

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

None.

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Judge

Counts are for claude-sonnet-5-5. claude-opus-5-5 compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task | Wins | Ties | Losses | Skipped | Judge errors | Win rate                    |
| ---- | ---- | ---- | ------ | ------- | ------------ | --------------------------- |
| tips | 6    | 7    | 11     | 0       | 0            | 35.3% (6 won of 17 decided) |

## tips

| Metric                 | golden | claude-sonnet-5-5 | Delta   | Noise |
| ---------------------- | ------ | ----------------- | ------- | ----- |
| Answered without error | 100.0% | 100.0%            | ±0.0 pp | noise |
| Item counts in range   | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                 | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Calls                                                                 | 24                     | 24                     |
| Latency p50                                                           | 5.4s                   | 4.7s                   |
| Latency max (budget 45.0s, `TIPS_AI_BUDGET_MS`)                       | 10.2s                  | 9.4s                   |
| Calls over budget                                                     | 0                      | 0                      |
| Calls retried (latency includes retries)                              | 0                      | 0                      |
| Errors                                                                | none                   | none                   |
| Truncated (`finishReason: length`)                                    | 0                      | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1293 · 494 · 0 · 0 · 0 | 1894 · 398 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0075                | $0.0078                |

**Total cost:** $0.95 (claude-sonnet-5-5 $0.19 over 24 calls, judge claude-opus-5-5 $0.76 over 48 calls). The golden's $0.18 was spent when it was recorded.
