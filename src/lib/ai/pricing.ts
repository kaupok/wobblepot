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
  /** USD per 1M input (prompt) tokens. */
  inputPerMTok: number
  /** USD per 1M output (completion) tokens. */
  outputPerMTok: number
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
}

export interface EstimateCostInput {
  model: string
  inputTokens: number
  outputTokens: number
}

/**
 * Estimate the USD cost of an AI call from token counts.
 *
 * Returns 0 for unknown models — caller decides whether to record a usage row
 * with $0 (still useful for visibility) or to skip recording entirely.
 */
export function estimateCostUsd({ model, inputTokens, outputTokens }: EstimateCostInput): number {
  const price = MODEL_PRICES[model]
  if (!price) return 0
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000
}
