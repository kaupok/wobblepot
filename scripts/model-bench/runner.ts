/**
 * Runs every case through both models (HON-795).
 *
 * Calls are sequential. For each case and run the baseline and the candidate
 * are called back to back, and which goes first alternates, so rate limits and
 * time-of-day drift do not favour either model.
 */

import { NoObjectGeneratedError, type LanguageModel, type LanguageModelUsage } from 'ai'
import { toAiUsageStats, type AiUsageStats } from '../../src/lib/ai/usage-mapping'
import { estimateCostUsd } from '../../src/lib/ai/pricing'
import type { BenchCase, Task } from './case-schema'
import { errorScores, prepareCase, type PreparedCase } from './tasks'
import type { Scores } from './scorers'

export type Role = 'baseline' | 'candidate'

/** Injectable so tests pass a `MockLanguageModelV4`; the CLI passes `createAnthropic`. */
export type ModelFactory = (modelId: string) => LanguageModel

export interface CallRecord {
  caseId: string
  task: Task
  /** 1-based. */
  run: number
  role: Role
  model: string
  /** 1 when this model went first in its pair, 2 when second. */
  position: 1 | 2
  /** Wall-clock time around `generateObject`, including the SDK's retries. */
  latencyMs: number
  finishReason: string | null
  /** `null` only when the call failed before any billed response. */
  usage: AiUsageStats | null
  reasoningTokens: number | null
  costUsd: number
  errorName: string | null
  errorMessage: string | null
  /** The parsed object, or the raw text a `NoObjectGeneratedError` carried. */
  output: unknown
  scores: Scores
}

export interface RunOptions {
  cases: BenchCase[]
  baseline: string
  candidate: string
  runs: number
  maxUsd: number
  modelFactory: ModelFactory
  /** Milliseconds; defaults to `performance.now`. */
  now?: () => number
  onCall?: (
    record: CallRecord,
    progress: { done: number; planned: number; spendUsd: number },
  ) => void
}

export interface RunResult {
  calls: CallRecord[]
  plannedCalls: number
  spendUsd: number
  /** `true` when `--max-usd` stopped the run early. */
  partial: boolean
}

export async function runBenchmark(options: RunOptions): Promise<RunResult> {
  const { cases, baseline, candidate, runs, maxUsd, modelFactory, onCall } = options
  const now = options.now ?? (() => performance.now())
  const plannedCalls = cases.length * runs * 2

  // Built once per case: the request does not depend on the run or the model.
  const prepared = cases.map((c) => ({ c, p: prepareCase(c) }))

  const calls: CallRecord[] = []
  let spendUsd = 0

  for (let run = 1; run <= runs; run++) {
    for (const [caseIndex, { c, p }] of prepared.entries()) {
      // Flips per case *and* per run: a single counter across both would give
      // every case the same first model in every run whenever the case count
      // is even, and a task with an odd count would lean one way every run.
      const order: [Role, string][] =
        (run - 1 + caseIndex) % 2 === 0
          ? [
              ['baseline', baseline],
              ['candidate', candidate],
            ]
          : [
              ['candidate', candidate],
              ['baseline', baseline],
            ]

      for (const [i, [role, model]] of order.entries()) {
        const record = await callOnce({
          c,
          p,
          run,
          role,
          model,
          position: i === 0 ? 1 : 2,
          modelFactory,
          now,
        })
        calls.push(record)
        spendUsd += record.costUsd
        onCall?.(record, { done: calls.length, planned: plannedCalls, spendUsd })

        // Checked after every call, not every pair: one expensive call can
        // cross the limit on its own.
        if (spendUsd > maxUsd) {
          return { calls, plannedCalls, spendUsd, partial: true }
        }
      }
    }
  }

  return { calls, plannedCalls, spendUsd, partial: false }
}

async function callOnce(args: {
  c: BenchCase
  p: PreparedCase
  run: number
  role: Role
  model: string
  position: 1 | 2
  modelFactory: ModelFactory
  now: () => number
}): Promise<CallRecord> {
  const { c, p, run, role, model, position, modelFactory, now } = args
  const base = { caseId: c.id, task: c.task, run, role, model, position }

  let usage: LanguageModelUsage | undefined
  let finishReason: string | null = null
  let output: unknown = null
  let scores: Scores
  let errorName: string | null = null
  let errorMessage: string | null = null
  let latencyMs: number

  const languageModel = modelFactory(model)
  const start = now()
  try {
    const result = await p.generate(languageModel)
    latencyMs = now() - start
    usage = result.usage
    finishReason = result.finishReason
    output = result.object
    scores = p.score(result.object)
  } catch (err) {
    latencyMs = now() - start
    errorName = err instanceof Error ? err.name : 'UnknownError'
    errorMessage = err instanceof Error ? err.message : String(err)
    // Output the schema rejected is still a billed call, and a truncated one
    // (`finishReason: 'length'`) lands here too — count both toward spend.
    if (NoObjectGeneratedError.isInstance(err)) {
      usage = err.usage
      finishReason = err.finishReason ?? null
      output = err.text ?? null
    }
    scores = errorScores(c)
  }

  const stats = usage ? toAiUsageStats(model, usage) : null

  return {
    ...base,
    latencyMs,
    finishReason,
    usage: stats,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? null,
    costUsd: stats ? estimateCostUsd(stats) : 0,
    errorName,
    errorMessage,
    output,
    scores,
  }
}
