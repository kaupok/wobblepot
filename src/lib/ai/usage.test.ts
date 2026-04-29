import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { prisma } from '@/lib/prisma'
import { getPosthogServer } from '@/lib/posthog-server'
import { AiCostCapExceededError, assertUnderCap, getMonthBoundaries, recordAiUsage } from './usage'

const mockHouseholdFindUnique = vi.mocked(prisma.household.findUnique)
const mockAggregate = vi.mocked(prisma.aiUsage.aggregate)
const mockCreate = vi.mocked(prisma.aiUsage.create)
const mockGetPosthogServer = vi.mocked(getPosthogServer)

let mockCapture: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockCapture = vi.fn()
  mockGetPosthogServer.mockReturnValue({ capture: mockCapture } as never)
})

describe('getMonthBoundaries', () => {
  it('returns the start and end of the current calendar month in UTC for a UTC timezone', () => {
    // Mid-April 2026 in UTC
    const now = new Date('2026-04-15T12:00:00.000Z')
    const { start, end } = getMonthBoundaries('UTC', now)

    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-05-01T00:00:00.000Z')
  })

  it('rolls over December → January at year boundary', () => {
    const now = new Date('2026-12-15T12:00:00.000Z')
    const { start, end } = getMonthBoundaries('UTC', now)

    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('places the same UTC instant in different calendar months for two timezones', () => {
    // 2026-04-01 02:00 UTC. In Europe/Tallinn (UTC+3 in summer) this is already
    // April. In America/Los_Angeles (UTC-7 in summer) this is still March 31.
    const now = new Date('2026-04-01T02:00:00.000Z')
    const tallinn = getMonthBoundaries('Europe/Tallinn', now)
    const la = getMonthBoundaries('America/Los_Angeles', now)

    // Tallinn at 02:00 UTC on Apr 1 is May offset away from May; April month
    // covers April 1 local → May 1 local.
    expect(tallinn.start.toISOString()).toBe('2026-03-31T21:00:00.000Z')
    expect(tallinn.end.toISOString()).toBe('2026-04-30T21:00:00.000Z')

    // LA still in March: March covers March 1 local → April 1 local.
    expect(la.start.toISOString()).toBe('2026-03-01T08:00:00.000Z')
    expect(la.end.toISOString()).toBe('2026-04-01T07:00:00.000Z')
  })
})

describe('assertUnderCap', () => {
  it('resolves silently when the household is under cap', async () => {
    mockHouseholdFindUnique.mockResolvedValue({
      timezone: 'UTC',
      aiCapUsd: 5,
    } as never)
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 1.5 } } as never)

    await expect(assertUnderCap('h1')).resolves.toBeUndefined()
  })

  it('throws AiCostCapExceededError with reset date and household timezone when at cap', async () => {
    const now = new Date('2026-04-15T12:00:00.000Z')
    mockHouseholdFindUnique.mockResolvedValue({
      timezone: 'Europe/Tallinn',
      aiCapUsd: 5,
    } as never)
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 5 } } as never)

    await expect(assertUnderCap('h1', now)).rejects.toBeInstanceOf(AiCostCapExceededError)
    try {
      await assertUnderCap('h1', now)
    } catch (error) {
      expect(error).toBeInstanceOf(AiCostCapExceededError)
      const e = error as AiCostCapExceededError
      // For Tallinn (UTC+3 in summer), May 1 00:00 local is April 30 21:00 UTC.
      expect(e.resetAt.toISOString()).toBe('2026-04-30T21:00:00.000Z')
      expect(e.timezone).toBe('Europe/Tallinn')
    }
  })

  it('throws when over cap, not just at it', async () => {
    mockHouseholdFindUnique.mockResolvedValue({
      timezone: 'UTC',
      aiCapUsd: 5,
    } as never)
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 7.25 } } as never)

    await expect(assertUnderCap('h1')).rejects.toBeInstanceOf(AiCostCapExceededError)
  })

  it('returns silently when the household does not exist (deleted mid-request)', async () => {
    mockHouseholdFindUnique.mockResolvedValue(null)
    await expect(assertUnderCap('missing')).resolves.toBeUndefined()
  })
})

describe('recordAiUsage', () => {
  it('writes one row with computed cost on success', async () => {
    mockCreate.mockResolvedValue({} as never)

    await recordAiUsage({
      householdId: 'h1',
      feature: 'plan_generate',
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      outputTokens: 0,
    })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: 'h1',
        feature: 'plan_generate',
        model: 'claude-sonnet-4-6',
        inputTokens: 1_000_000,
        outputTokens: 0,
        estimatedCostUsd: 3,
        success: true,
        retryCount: 0,
        requestId: null,
      }),
    })
  })

  it('does not throw when prisma.aiUsage.create rejects', async () => {
    mockCreate.mockRejectedValue(new Error('DB hiccup'))

    await expect(
      recordAiUsage({
        householdId: 'h1',
        feature: 'recipe_parse',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('recordAiUsage › PostHog streaming', () => {
  it('captures one $ai_generation event with the documented property shape on success', async () => {
    mockCreate.mockResolvedValue({} as never)

    await recordAiUsage({
      householdId: 'h1',
      feature: 'plan_generate',
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      outputTokens: 0,
      retryCount: 0,
      requestId: 'req-abc',
    })

    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'h1',
      event: '$ai_generation',
      properties: {
        $ai_input_tokens: 1_000_000,
        $ai_output_tokens: 0,
        $ai_model: 'claude-sonnet-4-6',
        $ai_total_cost_usd: 3,
        $ai_provider: 'anthropic',
        $ai_trace_id: 'req-abc',
        $ai_is_error: false,
        feature: 'plan_generate',
        household_id: 'h1',
        retry_count: 0,
      },
    })
  })

  it('sends $ai_trace_id: undefined (not null) when requestId is missing', async () => {
    mockCreate.mockResolvedValue({} as never)

    await recordAiUsage({
      householdId: 'h1',
      feature: 'recipe_parse',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
    })

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ $ai_trace_id: undefined }),
      }),
    )
  })

  it('sets $ai_is_error: true when success is false', async () => {
    mockCreate.mockResolvedValue({} as never)

    await recordAiUsage({
      householdId: 'h1',
      feature: 'meal_imagine',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 0,
      success: false,
    })

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ $ai_is_error: true }),
      }),
    )
  })

  it('does not throw when posthog.capture throws', async () => {
    mockCreate.mockResolvedValue({} as never)
    mockCapture.mockImplementation(() => {
      throw new Error('PostHog network error')
    })

    await expect(
      recordAiUsage({
        householdId: 'h1',
        feature: 'recipe_parse',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
      }),
    ).resolves.toBeUndefined()

    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('does not call capture when getPosthogServer returns null (env unset)', async () => {
    mockCreate.mockResolvedValue({} as never)
    mockGetPosthogServer.mockReturnValue(null)

    await recordAiUsage({
      householdId: 'h1',
      feature: 'recipe_parse',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
    })

    expect(mockCapture).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('captures even when the DB write fails (independent failure domains)', async () => {
    mockCreate.mockRejectedValue(new Error('DB hiccup'))

    await recordAiUsage({
      householdId: 'h1',
      feature: 'recipe_parse',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
    })

    expect(mockCapture).toHaveBeenCalledTimes(1)
  })
})
