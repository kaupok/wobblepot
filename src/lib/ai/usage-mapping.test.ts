/**
 * Proves the seam between the AI SDK's returned `usage` object and the token
 * counts we bill against: `result.usage` → `onAiUsage` → `recordAiUsage` →
 * `ai_usage` row + PostHog `$ai_generation` event.
 *
 * Every other test in `src/lib/ai/` either mocks `generateObject` without a
 * `usage` field or calls `recordAiUsage` with hand-written numbers, so nothing
 * asserts that the counts actually arrive — each call site reads them as
 * `?? 0`, and a broken mapping keeps recording zeroed rows and zero-cost
 * `$ai_generation` events rather than throwing.
 *
 * A *renamed* SDK field is not what this test is for: `tsc` already rejects
 * `result.usage?.inputTokens` at the call site the moment the field stops
 * existing (which is why the mutation check on this file needs a cast to
 * compile at all). What is unguarded is everything type-checking cannot see —
 * a call site that quietly stops reading `usage`, wires up the wrong field, or
 * drops the `onAiUsage` call, all of which keep compiling and bill $0.
 *
 * The `LanguageModelUsage` annotation on the fixture serves that goal rather
 * than duplicating the compile-time check: it stops this file from asserting
 * against a hand-invented shape. Without it the fixture could drift from what
 * the SDK really returns and the assertions below would keep passing while
 * proving nothing about production.
 *
 * `reviewMealQuantities` stands in for the seven call sites that record usage:
 * they share one extraction expression, and it is the only one with no Prisma
 * dependencies of its own. (There are eight `generateObject` calls in all —
 * `probes.ts:171` is the one that records nothing.)
 *
 * Added for the ai@6 → ai@7 upgrade (HON-637). `inputTokens` / `outputTokens`
 * are unchanged, and the `inputTokenDetails` / `outputTokenDetails` sub-objects
 * the fixture carries already existed in ai@6.0.116 — v7 added neither. What v7
 * removed is the deprecated top-level `usage.cachedInputTokens` /
 * `usage.reasoningTokens`. No call site read either, but the distinction is
 * worth recording here: cache-aware cost attribution is the obvious next change
 * to `estimateCostUsd`, and `cachedInputTokens` is exactly the field someone
 * would reach for. It is gone — the equivalent is
 * `usage.inputTokenDetails.cacheReadTokens`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}))

vi.mock('@/lib/env', () => ({
  serverEnv: { ANTHROPIC_API_KEY: 'test-key' },
}))

vi.mock('./sampling', () => ({
  logAiSample: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    household: { findUnique: vi.fn() },
    aiUsage: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: vi.fn(),
}))

vi.mock('@/lib/request-id', () => ({
  getRequestId: vi.fn(),
}))

import { generateObject, type LanguageModelUsage } from 'ai'
import { prisma } from '@/lib/prisma'
import { getPosthogServer } from '@/lib/posthog-server'
import { getRequestId } from '@/lib/request-id'
import { reviewMealQuantities, type ReviewIngredient } from './review-quantities'
import { REVIEW_MODEL } from './models'
import { recordAiUsage, type AiUsageStats } from './usage'

const mockGenerateObject = vi.mocked(generateObject)
const mockCreate = vi.mocked(prisma.aiUsage.create)
const mockGetPosthogServer = vi.mocked(getPosthogServer)
const mockGetRequestId = vi.mocked(getRequestId)

let mockCapture: ReturnType<typeof vi.fn>

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
const USAGE_FIXTURE: LanguageModelUsage = {
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

const sampleIngredients: ReviewIngredient[] = [
  { ingredientId: 'ing-chicken', name: 'Chicken breast', quantityPerServing: 150, unit: 'g' },
]

/**
 * Run the real call site against the fixture and return what it handed to
 * `onAiUsage` — the value every AI surface then passes to `recordAiUsage`.
 */
async function captureUsageStats(): Promise<AiUsageStats> {
  mockGenerateObject.mockResolvedValue({
    object: { ingredients: [{ ingredientId: 'ing-chicken', quantityPerServing: 150 }] },
    usage: USAGE_FIXTURE,
  } as never)

  const onAiUsage = vi.fn()
  await reviewMealQuantities('Chicken stir fry', 4, sampleIngredients, 'en', onAiUsage)

  expect(onAiUsage).toHaveBeenCalledTimes(1)
  return onAiUsage.mock.calls[0]![0] as AiUsageStats
}

describe('AI SDK usage → recordAiUsage mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCapture = vi.fn()
    mockGetPosthogServer.mockReturnValue({ capture: mockCapture } as never)
    mockGetRequestId.mockReturnValue(undefined)
    mockCreate.mockResolvedValue({} as never)
  })

  it('reads the SDK usage fields into non-zero, correctly named token counts', async () => {
    const stats = await captureUsageStats()

    expect(stats).toEqual({
      model: REVIEW_MODEL,
      inputTokens: 1531,
      outputTokens: 787,
    })
  })

  it('does not silently zero the counts when the SDK returns usage', async () => {
    const stats = await captureUsageStats()

    // The `?? 0` fallback at every call site makes a broken mapping look like
    // a free, successful call rather than an error — assert against it
    // directly, since no type or thrown error will.
    expect(stats.inputTokens).toBeGreaterThan(0)
    expect(stats.outputTokens).toBeGreaterThan(0)
  })

  it('writes the SDK counts to the ai_usage row under the billed field names', async () => {
    const stats = await captureUsageStats()

    await recordAiUsage({ ...stats, householdId: 'h1', feature: 'meal_review_quantities' })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: 'h1',
        feature: 'meal_review_quantities',
        model: REVIEW_MODEL,
        inputTokens: 1531,
        outputTokens: 787,
      }),
    })

    // Cost is derived from those counts, so a zeroed mapping would bill $0 and
    // leave the monthly cap permanently un-tripped.
    const { estimatedCostUsd } = mockCreate.mock.calls[0]![0].data as { estimatedCostUsd: number }
    expect(estimatedCostUsd).toBeGreaterThan(0)
  })

  it('mirrors the SDK counts to the PostHog $ai_generation event', async () => {
    const stats = await captureUsageStats()

    await recordAiUsage({ ...stats, householdId: 'h1', feature: 'meal_review_quantities' })

    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: '$ai_generation',
        properties: expect.objectContaining({
          $ai_input_tokens: 1531,
          $ai_output_tokens: 787,
          $ai_model: REVIEW_MODEL,
        }),
      }),
    )
  })
})
