/**
 * Per-model AI pricing for cost estimation.
 *
 * Anthropic does not return cost in response headers — we compute it from
 * token counts and a static price table. Update this table when models change
 * (rare, same cadence as `models.ts`).
 *
 * Prices are in USD per million tokens, taken from Anthropic's pricing page.
 */

export interface ModelPrice {
  /** USD per 1M uncached input (prompt) tokens. */
  inputPerMTok: number
  /** USD per 1M input tokens served from the prompt cache (0.1× base input). */
  cacheReadPerMTok: number
  /**
   * USD per 1M input tokens written to the prompt cache, at the 5-minute TTL
   * rate (1.25× base input). The SDK reports one `cacheWriteTokens` count with
   * no TTL split, so 1-hour writes (2× base input) would be under-estimated —
   * revisit if a call site ever opts into `ttl: '1h'`.
   */
  cacheWritePerMTok: number
  /** USD per 1M output (completion) tokens. */
  outputPerMTok: number
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-5': {
    inputPerMTok: 2,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    outputPerMTok: 10,
  },
  // Retained after the Sonnet 5 upgrade (HON-693): historical `AiUsage` rows
  // and any in-flight request still carry this model, and an entry missing
  // from the table prices at $0 rather than failing loudly.
  'claude-sonnet-4-6': {
    inputPerMTok: 3,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    outputPerMTok: 15,
  },
}

export interface EstimateCostInput {
  model: string
  /** Uncached input tokens, billed at the base input rate. */
  inputTokens: number
  /** Input tokens read from the prompt cache. Defaults to 0. */
  cacheReadTokens?: number
  /** Input tokens written to the prompt cache. Defaults to 0. */
  cacheWriteTokens?: number
  outputTokens: number
}

/**
 * Estimate the USD cost of an AI call from token counts.
 *
 * Each input tier is priced at its own rate: `inputTokens` must be the
 * uncached count, not the SDK's total, or cached tokens are billed twice.
 *
 * Returns 0 for unknown models — caller decides whether to record a usage row
 * with $0 (still useful for visibility) or to skip recording entirely.
 */
export function estimateCostUsd({
  model,
  inputTokens,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  outputTokens,
}: EstimateCostInput): number {
  const price = MODEL_PRICES[model]
  if (!price) return 0
  return (
    (inputTokens * price.inputPerMTok +
      cacheReadTokens * price.cacheReadPerMTok +
      cacheWriteTokens * price.cacheWritePerMTok +
      outputTokens * price.outputPerMTok) /
    1_000_000
  )
}
