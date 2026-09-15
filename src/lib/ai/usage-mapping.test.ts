/**
 * Proves the seam between the AI SDK's returned `usage` object and the token
 * counts we bill against: `result.usage` → `toAiUsageStats` → `recordAiUsage`
 * → `ai_usage` row + PostHog `$ai_generation` event.
 *
 * `toAiUsageStats` is the only place the SDK's counts are read (HON-647). Each
 * of the seven call sites that record usage has its own test asserting it
 * hands the helper's output to `onAiUsage` / `recordAiUsage`, so a call site
 * that quietly drops the call, or wires up the wrong model, fails there. This
 * file covers the helper itself and what it feeds downstream.
 *
 * A *renamed* SDK field is not what this test is for: `tsc` already rejects
 * `usage?.inputTokens` in the helper the moment the field stops existing. What
 * type-checking cannot see is a count that is *absent*: in ai@7 both counts are
 * `number | undefined`, and a `0` default makes that look like a free call that
 * never trips the cost cap. `usageMissing` is what keeps it visible.
 *
 * Added for the ai@6 → ai@7 upgrade (HON-637). `inputTokens` / `outputTokens`
 * are unchanged, and the `inputTokenDetails` / `outputTokenDetails` sub-objects
 * the fixture carries already existed in ai@6.0.116 — v7 added neither. What v7
 * removed is the deprecated top-level `usage.cachedInputTokens` /
 * `usage.reasoningTokens`. The cache-tier split that `estimateCostUsd` prices
 * (HON-648) is read from `usage.inputTokenDetails` instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

import type { LanguageModelUsage } from 'ai'
import { prisma } from '@/lib/prisma'
import { getPosthogServer } from '@/lib/posthog-server'
import { getRequestId } from '@/lib/request-id'
import { REVIEW_MODEL } from './models'
import { estimateCostUsd } from './pricing'
import { USAGE_FIXTURE } from './usage-fixture'
import { recordAiUsage, toAiUsageStats } from './usage'

const mockCreate = vi.mocked(prisma.aiUsage.create)
const mockGetPosthogServer = vi.mocked(getPosthogServer)
const mockGetRequestId = vi.mocked(getRequestId)

let mockCapture: ReturnType<typeof vi.fn>

describe('toAiUsageStats', () => {
  it('reads the SDK usage fields into non-zero, correctly named token counts', () => {
    expect(toAiUsageStats(REVIEW_MODEL, USAGE_FIXTURE)).toEqual({
      model: REVIEW_MODEL,
      inputTokens: 1031,
      cacheReadTokens: 500,
      cacheWriteTokens: 0,
      outputTokens: 787,
      usageMissing: false,
    })
  })

  it('splits the input total into uncached, cache-read and cache-write tiers', () => {
    const usage: LanguageModelUsage = {
      ...USAGE_FIXTURE,
      inputTokens: 1531 + 213,
      inputTokenDetails: { noCacheTokens: 1031, cacheReadTokens: 500, cacheWriteTokens: 213 },
    }

    expect(toAiUsageStats(REVIEW_MODEL, usage)).toMatchObject({
      inputTokens: 1031,
      cacheReadTokens: 500,
      cacheWriteTokens: 213,
      usageMissing: false,
    })
  })

  it('derives the uncached count from the total when the provider omits noCacheTokens', () => {
    const usage: LanguageModelUsage = {
      ...USAGE_FIXTURE,
      inputTokens: 1744,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 500, cacheWriteTokens: 213 },
    }

    expect(toAiUsageStats(REVIEW_MODEL, usage)).toMatchObject({
      inputTokens: 1031,
      cacheReadTokens: 500,
      cacheWriteTokens: 213,
    })
  })

  it('bills the whole total as uncached when the provider reports no breakdown at all', () => {
    const usage = {
      ...USAGE_FIXTURE,
      inputTokenDetails: undefined,
    } as unknown as LanguageModelUsage

    expect(toAiUsageStats(REVIEW_MODEL, usage)).toMatchObject({
      inputTokens: 1531,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      usageMissing: false,
    })
  })

  it('flags usage as missing and zeroes the counts when the SDK returns no usage', () => {
    expect(toAiUsageStats(REVIEW_MODEL, undefined)).toEqual({
      model: REVIEW_MODEL,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      usageMissing: true,
    })
  })

  it('flags usage as missing when only the input count is absent, zeroing every input tier', () => {
    const usage: LanguageModelUsage = { ...USAGE_FIXTURE, inputTokens: undefined }

    expect(toAiUsageStats(REVIEW_MODEL, usage)).toEqual({
      model: REVIEW_MODEL,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 787,
      usageMissing: true,
    })
  })

  it('flags usage as missing when only the output count is absent, keeping the input counts', () => {
    const usage: LanguageModelUsage = { ...USAGE_FIXTURE, outputTokens: undefined }

    expect(toAiUsageStats(REVIEW_MODEL, usage)).toEqual({
      model: REVIEW_MODEL,
      inputTokens: 1031,
      cacheReadTokens: 500,
      cacheWriteTokens: 0,
      outputTokens: 0,
      usageMissing: true,
    })
  })

  it('treats a non-finite count as missing rather than billing NaN', () => {
    const usage: LanguageModelUsage = { ...USAGE_FIXTURE, inputTokens: Number.NaN }

    expect(toAiUsageStats(REVIEW_MODEL, usage)).toMatchObject({
      inputTokens: 0,
      usageMissing: true,
    })
  })

  it('does not flag a genuine zero count as missing', () => {
    const usage: LanguageModelUsage = { ...USAGE_FIXTURE, outputTokens: 0 }

    expect(toAiUsageStats(REVIEW_MODEL, usage).usageMissing).toBe(false)
  })
})

describe('toAiUsageStats → recordAiUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCapture = vi.fn()
    mockGetPosthogServer.mockReturnValue({ capture: mockCapture } as never)
    mockGetRequestId.mockReturnValue(undefined)
    mockCreate.mockResolvedValue({} as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes the SDK counts to the ai_usage row under the billed field names', async () => {
    const stats = toAiUsageStats(REVIEW_MODEL, USAGE_FIXTURE)

    await recordAiUsage({ ...stats, householdId: 'h1', feature: 'meal_review_quantities' })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: 'h1',
        feature: 'meal_review_quantities',
        model: REVIEW_MODEL,
        inputTokens: 1031,
        outputTokens: 787,
      }),
    })

    // Cost is derived from those counts, so a zeroed mapping would bill $0 and
    // leave the monthly cap permanently un-tripped.
    const { estimatedCostUsd } = mockCreate.mock.calls[0]![0].data as { estimatedCostUsd: number }
    expect(estimatedCostUsd).toBeGreaterThan(0)
  })

  it('prices the cache-read tier into the recorded cost instead of billing the total at base rate', async () => {
    const stats = toAiUsageStats(REVIEW_MODEL, USAGE_FIXTURE)

    await recordAiUsage({ ...stats, householdId: 'h1', feature: 'meal_review_quantities' })

    const { estimatedCostUsd } = mockCreate.mock.calls[0]![0].data as { estimatedCostUsd: number }
    expect(estimatedCostUsd).toBe(
      estimateCostUsd({
        model: REVIEW_MODEL,
        inputTokens: 1031,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
        outputTokens: 787,
      }),
    )
    expect(estimatedCostUsd).toBeLessThan(
      estimateCostUsd({ model: REVIEW_MODEL, inputTokens: 1531, outputTokens: 787 }),
    )
  })

  it('mirrors the SDK counts to the PostHog $ai_generation event', async () => {
    const stats = toAiUsageStats(REVIEW_MODEL, USAGE_FIXTURE)

    await recordAiUsage({ ...stats, householdId: 'h1', feature: 'meal_review_quantities' })

    expect(mockCapture).toHaveBeenCalledTimes(1)
    const { properties } = mockCapture.mock.calls[0]![0] as { properties: Record<string, unknown> }
    expect(properties).toMatchObject({
      $ai_input_tokens: 1031,
      $ai_cache_read_input_tokens: 500,
      $ai_cache_creation_input_tokens: 0,
      $ai_output_tokens: 787,
      $ai_model: REVIEW_MODEL,
    })
    expect(properties).not.toHaveProperty('$ai_usage_missing')
  })

  it('still writes the row for partially missing usage, but flags it on PostHog and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stats = toAiUsageStats(REVIEW_MODEL, { ...USAGE_FIXTURE, inputTokens: undefined })

    await recordAiUsage({ ...stats, householdId: 'h1', feature: 'meal_review_quantities' })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ inputTokens: 0, outputTokens: 787 }),
    })
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ $ai_usage_missing: true }),
      }),
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
