/**
 * The pure half of AI usage tracking: mapping the AI SDK's `result.usage` to
 * the stats every AI surface bills against.
 *
 * Kept apart from `./usage`, which reaches Prisma, PostHog and `next/server`,
 * so it loads under plain `tsx` with no environment — the model benchmark
 * (HON-795) reads token counts through the same function production bills
 * with (HON-796). Imports only types.
 */

import type { LanguageModelUsage } from 'ai'

export interface AiUsageStats {
  model: string
  /**
   * Uncached input tokens — the count billed at the base input rate. Not the
   * SDK's `usage.inputTokens`, which is the total including cache tiers.
   */
  inputTokens: number
  /** Input tokens served from the prompt cache. */
  cacheReadTokens: number
  /** Input tokens written to the prompt cache. */
  cacheWriteTokens: number
  outputTokens: number
  /**
   * `true` when the SDK response carried no usable input or output count.
   * The counts above are then `0` placeholders, not a free call.
   */
  usageMissing: boolean
  /**
   * `false` when the call was billed but produced no usable object (see
   * `withUsageOnFailure`). Absent means `true`.
   */
  success?: boolean
  /**
   * Wall-clock time of the model call, in ms. Sent to PostHog as `$ai_latency`
   * (seconds), the only property its LLM analytics reads latency from.
   */
  durationMs?: number
}

/**
 * Map the AI SDK's `result.usage` to the stats every AI surface bills against.
 * This is the only place the SDK's token counts are read.
 *
 * In ai@7 both counts are `number | undefined`. A missing (or non-finite) count
 * still records as `0` so the row is written, but sets `usageMissing` so
 * `recordAiUsage` can flag it — a silent `0` is indistinguishable from a free
 * call and never trips the cost cap. No fallback estimate: a wrong number in
 * the cap is worse than a visible zero, so a missing input total zeroes every
 * input tier rather than billing whatever breakdown happens to be present.
 *
 * `usage.inputTokens` is the *total* (`noCache + cacheRead + cacheWrite`), and
 * the tiers are priced differently (HON-648), so the input is split using
 * `usage.inputTokenDetails`. When a provider omits `noCacheTokens`, it is
 * derived from the total minus the cache tiers.
 */
export function toAiUsageStats(
  model: string,
  usage: LanguageModelUsage | undefined,
  durationMs?: number,
): AiUsageStats {
  const totalInputTokens = finiteOrNull(usage?.inputTokens)
  const outputTokens = finiteOrNull(usage?.outputTokens)
  const usageMissing = totalInputTokens === null || outputTokens === null

  let inputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0

  if (totalInputTokens !== null) {
    // `inputTokenDetails` is typed as always present, but stay defensive: a
    // provider (or a hand-built usage object) may leave it out entirely.
    const details = usage?.inputTokenDetails as LanguageModelUsage['inputTokenDetails'] | undefined
    cacheReadTokens = finiteOrNull(details?.cacheReadTokens) ?? 0
    cacheWriteTokens = finiteOrNull(details?.cacheWriteTokens) ?? 0
    inputTokens =
      finiteOrNull(details?.noCacheTokens) ??
      Math.max(0, totalInputTokens - cacheReadTokens - cacheWriteTokens)
  }

  return {
    model,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: outputTokens ?? 0,
    usageMissing,
    ...(durationMs !== undefined && { durationMs }),
  }
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
