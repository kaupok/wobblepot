# Model benchmark: golden vs claude-sonnet-5-5

2026-10-28 · 3 run(s) · tasks: cook-question · 48 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-19 at `a3fa05be`, 3 run(s).

**Prompts since the golden:** cook-question: prompt changed for 16 of 16 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **cook-question · No unbacked claim:** 66.7% → 100.0% (+33.3 pp)

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## Safety checks

The allergen and dietary checks, counted per call. No failure in a few dozen calls does not show the rate is zero: the figure in brackets is the highest failure rate still consistent with a clean result, at 95% confidence. Showing a rate under 5% takes 59 clean calls, and under 1% takes 299. Before a model change ships on a route with one of these checks, run enough cases or `--runs` that the bound is one you accept.

| Check                                   | golden                            | claude-sonnet-5-5                 |
| --------------------------------------- | --------------------------------- | --------------------------------- |
| cook-question · No forbidden suggestion | 0 of 24 failed (rate up to 11.7%) | 0 of 24 failed (rate up to 11.7%) |

## Judge

Counts are for claude-sonnet-5-5. claude-code/opus compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a `tie` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under 40% over at least 5 decided pairs is a regression. A pair is skipped when either model's call errored.

| Task          | Wins | Ties | Losses | Skipped | Judge errors | Win rate                     |
| ------------- | ---- | ---- | ------ | ------- | ------------ | ---------------------------- |
| cook-question | 26   | 11   | 11     | 0       | 0            | 70.3% (26 won of 37 decided) |

## cook-question

| Metric                                        | golden | claude-sonnet-5-5 | Delta    | Noise         |
| --------------------------------------------- | ------ | ----------------- | -------- | ------------- |
| Completed (no error, not cut off)             | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| Answered without error                        | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| Metric units only                             | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| ≤ 100 words                                   | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| ≤ 4 sentences                                 | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| Off-topic declined (≤ 50 words)               | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| No forbidden suggestion                       | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| No unbacked claim                             | 66.7%  | 100.0%            | +33.3 pp | outside range |
| Names the expected answer                     | 100.0% | 100.0%            | ±0.0 pp  | noise         |
| Leaves out what the changed list doesn't have | 100.0% | 100.0%            | ±0.0 pp  | noise         |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 48                       | 48                       |
| Latency p50                                                           | 2.0s                     | 1.9s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 9.4s                     | 10.1s                    |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1435 · 219 · 112 · 0 · 0 | 1476 · 230 · 124 · 0 · 0 |
| Cost / call                                                           | $0.0051                  | $0.0052                  |

**Total cost:** $0.25 (claude-sonnet-5-5 $0.25 over 48 calls, judge claude-code/opus $0.0000 over 96 calls). The golden's $0.24 was spent when it was recorded.
