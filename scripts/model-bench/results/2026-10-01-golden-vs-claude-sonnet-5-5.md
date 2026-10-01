# Model benchmark: golden vs claude-sonnet-5-5

2026-10-01 · 3 run(s) · tasks: imagine · 24 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-01 at `ef94fbf1`, 3 run(s).

**Prompts since the golden:** imagine: prompt changed for 8 of 8 cases.

> **How this golden was recorded (HON-906).** The baseline is the imagine prompt _before_ HON-896 (#989): `main` at `ef94fbf1` with `dd75a75f` reverted in the working tree, then `pnpm bench:models --record --task imagine`. The `commit` above is HEAD at that moment, not a commit that holds the old prompt. The candidate is the same model on `main`'s prompt, so the Judge section measures the prompt change alone. This golden was a scratch baseline for that question; the committed `golden/` was re-recorded from `main` afterwards (#996).

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

| Task    | Wins | Ties | Losses | Skipped | Judge errors | Win rate                     |
| ------- | ---- | ---- | ------ | ------- | ------------ | ---------------------------- |
| imagine | 11   | 10   | 3      | 0       | 0            | 78.6% (11 won of 14 decided) |

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
| Latency p50                                                           | 18.6s                     | 17.8s                     |
| Latency max (budget 45.0s, `IMAGINE_AI_BUDGET_MS`)                    | 25.4s                     | 24.2s                     |
| Calls over budget                                                     | 0                         | 0                         |
| Calls retried (latency includes retries)                              | 0                         | 0                         |
| Errors                                                                | none                      | none                      |
| Truncated (`finishReason: length`)                                    | 0                         | 0                         |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2974 · 2710 · 884 · 0 · 0 | 3081 · 2723 · 865 · 0 · 0 |
| Cost / call                                                           | $0.0330                   | $0.0334                   |

**Total cost:** $0.80 (claude-sonnet-5-5 $0.80 over 24 calls, judge claude-code/opus $0.0000 over 48 calls). The golden's $0.79 was spent when it was recorded.
