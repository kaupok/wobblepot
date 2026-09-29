/**
 * `--dry-run` estimate (HON-795): no API calls and no API key.
 *
 * Input tokens are estimated from prompt length at ~4 characters per token,
 * which errs high for English and roughly right for Estonian. Output tokens
 * are each task's `dryRunOutputTokens` guess. Both are rough: the number is
 * for choosing `--runs` and `--max-usd`, not for a budget.
 */

import { estimateCostUsd } from '../../src/lib/ai/pricing'
import type { BenchCase } from './case-schema'
import { TASK_SPECS, prepareCase } from './tasks'

export const CHARS_PER_TOKEN = 4

export interface DryRunEstimate {
  caseCount: number
  totalCalls: number
  perModel: {
    model: string
    calls: number
    inputTokens: number
    outputTokens: number
    costUsd: number
  }[]
  totalCostUsd: number
}

export function estimateRun(args: {
  cases: BenchCase[]
  runs: number
  models: [string, string]
}): DryRunEstimate {
  const { cases, runs, models } = args

  let inputTokens = 0
  let outputTokens = 0
  for (const c of cases) {
    inputTokens += Math.ceil(prepareCase(c).promptText.length / CHARS_PER_TOKEN)
    outputTokens += TASK_SPECS[c.task].dryRunOutputTokens
  }
  inputTokens *= runs
  outputTokens *= runs

  const perModel = models.map((model) => ({
    model,
    calls: cases.length * runs,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd({ model, inputTokens, outputTokens }),
  }))

  return {
    caseCount: cases.length,
    totalCalls: cases.length * runs * models.length,
    perModel,
    totalCostUsd: perModel.reduce((sum, m) => sum + m.costUsd, 0),
  }
}
