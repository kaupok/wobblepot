# Model benchmark: golden vs claude-sonnet-5-5

2026-10-05 · 3 run(s) · tasks: cook-question · 27 calls

**Baseline:** golden — `claude-sonnet-5-5` recorded 2026-10-03 at `0180a82d`, 3 run(s).

**Prompts since the golden:** cook-question: prompt changed for 9 of 9 cases.

## Regressions

None.

## Other changes outside noise

The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.

- **cook-question · ≤ 100 words:** 70.8% (62.5%–87.5%) → 100.0% (+29.2 pp)
- **cook-question · ≤ 4 sentences:** 41.7% (25.0%–50.0%) → 100.0% (+58.3 pp)

## Within noise

The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.

None.

## cook-question

| Metric                          | golden              | claude-sonnet-5-5 | Delta    | Noise         |
| ------------------------------- | ------------------- | ----------------- | -------- | ------------- |
| Answered without error          | 100.0%              | 100.0%            | ±0.0 pp  | noise         |
| Metric units only               | 100.0%              | 100.0%            | ±0.0 pp  | noise         |
| ≤ 100 words                     | 70.8% (62.5%–87.5%) | 100.0%            | +29.2 pp | outside range |
| ≤ 4 sentences                   | 41.7% (25.0%–50.0%) | 100.0%            | +58.3 pp | outside range |
| Off-topic declined (≤ 50 words) | 100.0%              | 100.0%            | ±0.0 pp  | noise         |
| No forbidden suggestion         | 100.0%              | 100.0%            | ±0.0 pp  | noise         |
| Names the expected answer       | 100.0%              | 100.0%            | ±0.0 pp  | noise         |

| Operational                                                           | golden                   | claude-sonnet-5-5        |
| --------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Calls                                                                 | 27                       | 27                       |
| Latency p50                                                           | 3.2s                     | 2.4s                     |
| Latency max (budget 30.0s, `COOK_QUESTION_AI_BUDGET_MS`)              | 13.3s                    | 10.9s                    |
| Calls over budget                                                     | 0                        | 0                        |
| Calls retried (latency includes retries)                              | 0                        | 0                        |
| Errors                                                                | none                     | none                     |
| Truncated (`finishReason: length`)                                    | 0                        | 0                        |
| Tokens / call (input · output · reasoning · cache read · cache write) | 1071 · 283 · 100 · 0 · 0 | 1123 · 317 · 196 · 0 · 0 |
| Cost / call                                                           | $0.0050                  | $0.0054                  |

**Total cost:** $0.15 (claude-sonnet-5-5 $0.15 over 27 calls). The golden's $0.13 was spent when it was recorded.
