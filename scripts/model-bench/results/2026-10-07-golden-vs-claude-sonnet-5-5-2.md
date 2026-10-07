# Model benchmark: golden vs claude-sonnet-5-5

2026-10-07 · 3 run(s) · tasks: imagine · 24 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s).

> **A control run (HON-1098).** The candidate is `main`'s imagine prompt, unchanged since the golden (`src/lib/ai` checked out from `origin/main` at `d354d58c`). It measures how the golden compares with a fresh run of the same prompt: 35.3% (6 won of 17 decided), under the 40% line with no prompt change at all. Read the imagine judge result in `2026-10-07-golden-vs-claude-sonnet-5-5.md` against this one.

**Prompts since the golden:** imagine: unchanged.

## Regressions

- **imagine · Judge win rate:** 35.3% (6 won of 17 decided) is under 40%

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

None.

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Judge

Counts are for claude-sonnet-5-5. claude-opus-5-5 compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task    | Wins | Ties | Losses | Skipped | Judge errors | Win rate                    |
| ------- | ---- | ---- | ------ | ------- | ------------ | --------------------------- |
| imagine | 6    | 7    | 11     | 0       | 0            | 35.3% (6 won of 17 decided) |

## imagine

| Metric                    | golden | claude-sonnet-5-5 | Delta   | Noise |
| ------------------------- | ------ | ----------------- | ------- | ----- |
| All checks pass           | 100.0% | 100.0%            | ±0.0 pp | noise |
| Exactly 3 meals           | 100.0% | 100.0%            | ±0.0 pp | noise |
| Servings = household size | 100.0% | 100.0%            | ±0.0 pp | noise |
| ≥ 2 ingredients each      | 100.0% | 100.0%            | ±0.0 pp | noise |
| No forbidden ingredient   | 100.0% | 100.0%            | ±0.0 pp | noise |

| Operational                                                           | golden                    | claude-sonnet-5-5         |
| --------------------------------------------------------------------- | ------------------------- | ------------------------- |
| Calls                                                                 | 24                        | 24                        |
| Latency p50                                                           | 19.1s                     | 18.3s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 25.8s                     | 25.3s                     |
| Calls over budget                                                     | 0                         | 0                         |
| Calls retried (latency includes retries)                              | 0                         | 0                         |
| Errors                                                                | none                      | none                      |
| Truncated (`finishReason: length`)                                    | 0                         | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 3081 · 2831 · 925 · 0 · 0 | 3081 · 2676 · 819 · 0 · 0 |
| Cost / call                                                           | $0.0345                   | $0.0329                   |

**Total cost:** $1.73 (claude-sonnet-5-5 $0.79 over 24 calls, judge claude-opus-5-5 $0.94 over 48 calls). The golden's $0.83 was spent when it was recorded.
