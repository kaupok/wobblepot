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

import { prisma } from '@/lib/prisma'
import { AiCostCapExceededError, assertUnderCap, getMonthBoundaries, recordAiUsage } from './usage'

const mockHouseholdFindUnique = vi.mocked(prisma.household.findUnique)
const mockAggregate = vi.mocked(prisma.aiUsage.aggregate)
const mockCreate = vi.mocked(prisma.aiUsage.create)

beforeEach(() => {
  vi.clearAllMocks()
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
