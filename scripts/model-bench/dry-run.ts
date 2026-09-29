/**
 * `--dry-run` estimate (HON-795): no API calls and no API key.
 *
 * Input tokens are estimated from prompt length at ~4 characters per token,
 * which errs high for English and roughly right for Estonian. Output tokens
 * are each task's `dryRunOutputTokens` guess. Both are rough: the number is
 * for choosing `--runs` and `--max-usd`, not for a budget.
 */

import { estimateCostUsd } from '../../src/lib/ai/pricing'
import type { BenchCase, CaseOf } from './case-schema'
import {
  JUDGE_DRY_RUN_OUTPUT_TOKENS,
  JUDGE_MODEL,
  buildJudgePrompt,
  isJudgedTask,
  type JudgedTask,
} from './judge'
import { TASK_SPECS, prepareCase } from './tasks'

export const CHARS_PER_TOKEN = 4

export interface ModelEstimate {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface DryRunEstimate {
  caseCount: number
  /** Every call, the judge's included. */
  totalCalls: number
  perModel: ModelEstimate[]
  /** `null` without `--judge`. */
  judge: ModelEstimate | null
  totalCostUsd: number
}

export function estimateRun(args: {
  cases: BenchCase[]
  runs: number
  models: [string, string]
  judge?: boolean
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

  const judge = args.judge ? estimateJudge(cases, runs) : null
  const benchCalls = cases.length * runs * models.length

  return {
    caseCount: cases.length,
    totalCalls: benchCalls + (judge?.calls ?? 0),
    perModel,
    judge,
    totalCostUsd: perModel.reduce((sum, m) => sum + m.costUsd, 0) + (judge?.costUsd ?? 0),
  }
}

/**
 * Two judge calls per judged case and run, one in each order. Input is the
 * judge's own prompt plus both answers, each taken at the task's output guess
 * — an overestimate, since that guess includes the benchmarked model's
 * reasoning, which the judge never sees.
 */
function estimateJudge(cases: BenchCase[], runs: number): ModelEstimate {
  const judged = cases.filter((c): c is CaseOf<JudgedTask> => isJudgedTask(c.task))

  let inputTokens = 0
  for (const c of judged) {
    const { system, prompt } = buildJudgePrompt(c, null, null)
    const promptTokens = Math.ceil((system.length + prompt.length) / CHARS_PER_TOKEN)
    inputTokens += 2 * (promptTokens + 2 * TASK_SPECS[c.task].dryRunOutputTokens)
  }
  inputTokens *= runs
  const calls = judged.length * runs * 2
  const outputTokens = calls * JUDGE_DRY_RUN_OUTPUT_TOKENS

  return {
    model: JUDGE_MODEL,
    calls,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd({ model: JUDGE_MODEL, inputTokens, outputTokens }),
  }
}
