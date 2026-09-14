/**
 * Shared ai@7 `usage` fixture for the call-site usage tests (HON-647).
 *
 * Every AI surface hands `result.usage` to `toAiUsageStats`; each call site's
 * test feeds this fixture through its mocked `generateObject` and asserts the
 * callback received the stats below. That is what makes deleting (or miswiring)
 * any one call site fail a test.
 *
 * Test-only: imported by `*.test.ts` files, never by application code.
 */

import type { LanguageModelUsage } from 'ai'

/**
 * A full ai@7 `usage` object, annotated with the SDK's own exported type so the
 * fixture's keys cannot drift from what the SDK really returns.
 *
 * The annotation constrains keys and types, not values, so the values are
 * matched to what `convertAnthropicUsage`
 * (`@ai-sdk/anthropic@4.0.49/dist/index.js:2017`) actually emits for the calls
 * this app makes — otherwise the fixture would be shape-valid but describe a
 * response Anthropic never sends:
 *
 * - `inputTokens` is the *total*: `noCache + cacheRead + cacheWrite`. Kept
 *   internally consistent below (1031 + 500 + 0 = 1531). Note that
 *   `estimateCostUsd` bills that whole total at the full input rate, which is
 *   correct only while nothing enables prompt caching.
 * - `outputTokenDetails` is left `undefined`: the provider derives both fields
 *   from `output_tokens_details.thinking_tokens`, so without extended thinking
 *   `text` and `reasoning` are `undefined` rather than a number.
 *
 * The two counts that *are* asserted on are deliberately distinct and
 * non-round: an assertion that passes with them swapped, doubled, or defaulted
 * to 0 would not prove the mapping.
 */
export const USAGE_FIXTURE: LanguageModelUsage = {
  inputTokens: 1531,
  inputTokenDetails: {
    noCacheTokens: 1031,
    cacheReadTokens: 500,
    cacheWriteTokens: 0,
  },
  outputTokens: 787,
  outputTokenDetails: {
    textTokens: undefined,
    reasoningTokens: undefined,
  },
  totalTokens: 2318,
}

/** The stats `toAiUsageStats(model, USAGE_FIXTURE)` must produce. */
export function expectedUsageStats(model: string) {
  return { model, inputTokens: 1531, outputTokens: 787, usageMissing: false }
}
