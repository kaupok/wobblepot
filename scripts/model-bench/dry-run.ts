/**
 * `--dry-run` estimate (HON-795): no API calls and no API key.
 *
 * Input tokens are estimated from prompt length at ~4 characters per token,
 * which errs high for English and roughly right for Estonian. Output tokens
 * are each task's `dryRunOutputTokens` guess. Both are rough: the number is
 * for choosing `--runs` and `--max-usd`, not for a budget.
 */

import { estimateCostUsd } from '../../src/lib/ai/pricing'
import type { BenchCase, CaseOf, Task } from './case-schema'
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
  /** Uncached input. */
  inputTokens: number
  /** Only the API judge's rubric is cached; zero for benchmarked models. */
  cacheWriteTokens?: number
  cacheReadTokens?: number
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

/** Every case through `model`, `runs` times. */
function estimateModel(model: string, cases: BenchCase[], runs: number): ModelEstimate {
  let inputTokens = 0
  let outputTokens = 0
  for (const c of cases) {
    inputTokens += Math.ceil(prepareCase(c).promptText.length / CHARS_PER_TOKEN)
    outputTokens += TASK_SPECS[c.task].dryRunOutputTokens
  }
  inputTokens *= runs
  outputTokens *= runs
  return {
    model,
    calls: cases.length * runs,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd({ model, inputTokens, outputTokens }),
  }
}

export function estimateRun(args: {
  cases: BenchCase[]
  runs: number
  /** One model under `--baseline golden`, whose baseline side is never called. */
  models: [string] | [string, string]
  judge?: boolean
}): DryRunEstimate {
  const { cases, runs, models } = args

  const perModel = models.map((model) => estimateModel(model, cases, runs))

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
 * `--check` (HON-901): one call per case and run, each case on its task's
 * model. One line per distinct model, in the order tasks first use it.
 */
export function estimateCheck(args: {
  cases: BenchCase[]
  runs: number
  modelFor: (task: Task) => string
}): DryRunEstimate {
  const { cases, runs, modelFor } = args
  const byModel = new Map<string, BenchCase[]>()
  for (const c of cases) {
    const model = modelFor(c.task)
    byModel.set(model, [...(byModel.get(model) ?? []), c])
  }
  const perModel = [...byModel].map(([model, mine]) => estimateModel(model, mine, runs))
  return {
    caseCount: cases.length,
    totalCalls: cases.length * runs,
    perModel,
    judge: null,
    totalCostUsd: perModel.reduce((sum, m) => sum + m.costUsd, 0),
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
  // The system prompt (rubric, plus the voice reference for `et`) is cached:
  // each distinct one is written once and read by every later call.
  const systemCalls = new Map<string, number>()
  for (const c of judged) {
    const { system, prompt } = buildJudgePrompt(c, null, null)
    const promptTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN)
    inputTokens += 2 * (promptTokens + 2 * TASK_SPECS[c.task].dryRunOutputTokens)
    systemCalls.set(system, (systemCalls.get(system) ?? 0) + 2 * runs)
  }
  inputTokens *= runs
  let cacheWriteTokens = 0
  let cacheReadTokens = 0
  for (const [system, n] of systemCalls) {
    const tokens = Math.ceil(system.length / CHARS_PER_TOKEN)
    cacheWriteTokens += tokens
    cacheReadTokens += tokens * (n - 1)
  }
  const calls = judged.length * runs * 2
  const outputTokens = calls * JUDGE_DRY_RUN_OUTPUT_TOKENS

  return {
    model: JUDGE_MODEL,
    calls,
    inputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    outputTokens,
    costUsd: estimateCostUsd({
      model: JUDGE_MODEL,
      inputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      outputTokens,
    }),
  }
}
