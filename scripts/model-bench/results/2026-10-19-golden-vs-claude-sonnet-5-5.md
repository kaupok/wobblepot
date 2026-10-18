# Model benchmark: golden vs claude-sonnet-5-5

2026-10-19 · 3 run(s) · tasks: tips · 30 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-19 at `0332c638`, 3 run(s).

**Prompts since the golden:** tips: prompt changed for 2 of 10 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **tips · Follows the adjustment instruction:** 50.0% → 100.0% (+50.0 pp)

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Judge

Counts are for claude-sonnet-5-5. claude-opus-5-5 compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task | Wins | Ties | Losses | Skipped | Judge errors | Win rate                     |
| ---- | ---- | ---- | ------ | ------- | ------------ | ---------------------------- |
| tips | 10   | 6    | 14     | 0       | 0            | 41.7% (10 won of 24 decided) |

## tips

| Metric                             | golden | claude-sonnet-5-5 | Delta    | Noise         |
| ---------------------------------- | ------ | ----------------- | -------- | ------------- |
| Completed (no error, not cut off)  | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| Answered without error             | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| Item counts in range               | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| Follows the adjustment instruction | 50.0%  | 100.0%            | +50.0 pp | outside range |

| Operational                                                           | golden                 | claude-sonnet-5-5      |
| --------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Calls                                                                 | 30                     | 30                     |
| Latency p50                                                           | 4.4s                   | 4.7s                   |
| Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)                      | 9.7s                   | 9.6s                   |
| Calls over budget                                                     | 0                      | 0                      |
| Calls retried (latency includes retries)                              | 0                      | 0                      |
| Errors                                                                | none                   | none                   |
| Truncated (`finishReason: length`)                                    | 0                      | 0                      |
| Tokens / call (input · output · reasoning · cache read · cache write) | 2176 · 425 · 0 · 0 · 0 | 2196 · 434 · 0 · 0 · 0 |
| Cost / call                                                           | $0.0086                | $0.0087                |

**Total cost:** $1.18 (claude-sonnet-5-5 $0.26 over 30 calls, judge claude-opus-5-5 $0.92 over 60 calls). The golden's $0.26 was spent when it was recorded.

## How the baseline was made (HON-1244)

The baseline is a scratch golden, not the committed one. It was recorded with `pnpm ai-eval --record --task tips --force` on the HON-1244 branch at `0332c638`, with `adjustmentSection` in `src/lib/ai/preparation-steps.ts` returning `''`, so every case got the steps prompt as it was before this PR: no stored instruction. The prompt was then restored, the comparison ran, and the committed `golden/tips.json` was put back. The scratch golden is not committed.

So only the two cases with an `adjustmentNote` (`tips/en-full-adjusted-less-salt-toddler`, `tips/et-full-adjusted-vahem-soola`) send a different prompt on the two sides. The judge picked the new prompt in all 6 of their pairs: each reason says the baseline ignored "less salt" or the toddler. The other 8 cases send byte-identical prompts, so their 4 wins, 6 ties and 14 losses compare a prompt with itself and are run-to-run noise.
