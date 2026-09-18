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

import { prisma } from '@/lib/prisma'
import { getPosthogServer } from '@/lib/posthog-server'
import { getRequestId } from '@/lib/request-id'
import {
  AiCostCapExceededError,
  assertUnderCap,
  getMonthBoundaries,
  recordAiUsage,
  withUsageOnFailure,
} from './usage'
import { expectedUsageStats, noObjectGeneratedError } from './usage-fixture'

const mockHouseholdFindUnique = vi.mocked(prisma.household.findUnique)
const mockAggregate = vi.mocked(prisma.aiUsage.aggregate)
const mockCreate = vi.mocked(prisma.aiUsage.create)
const mockGetPosthogServer = vi.mocked(getPosthogServer)
const mockGetRequestId = vi.mocked(getRequestId)

let mockCapture: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockCapture = vi.fn()
  mockGetPosthogServer.mockReturnValue({ capture: mockCapture } as never)
  mockGetRequestId.mockReturnValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
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

  it('prices cache-read and cache-write tokens at their own rates in the row and the PostHog event', async () => {
    mockCreate.mockResolvedValue({} as never)

    await recordAiUsage({
      householdId: 'h1',
      feature: 'plan_generate',
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      cacheReadTokens: 2_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 0,
    })

    // 1M × $3 + 2M × $0.30 + 1M × $3.75 = $7.35 — not the $12 an
    // all-at-base-rate estimate of the 4M input total would give.
    const { estimatedCostUsd } = mockCreate.mock.calls[0]![0].data as { estimatedCostUsd: number }
    expect(estimatedCostUsd).toBeCloseTo(7.35, 9)

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ inputTokens: 1_000_000 }),
    })
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $ai_input_tokens: 1_000_000,
          $ai_cache_read_input_tokens: 2_000_000,
          $ai_cache_creation_input_tokens: 1_000_000,
          $ai_total_cost_usd: estimatedCostUsd,
        }),
      }),
    )
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
        $ai_cache_read_input_tokens: 0,
        $ai_cache_creation_input_tokens: 0,
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

describe('recordAiUsage › requestId resolution', () => {
  it('prefers the explicit input.requestId over the AsyncLocalStorage value', async () => {
    mockCreate.mockResolvedValue({} as never)
    mockGetRequestId.mockReturnValue('als-id')

    await recordAiUsage({
      householdId: 'h1',
      feature: 'recipe_parse',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      requestId: 'explicit-id',
    })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestId: 'explicit-id' }),
    })
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ $ai_trace_id: 'explicit-id' }),
      }),
    )
  })

  it('falls back to getRequestId() when input.requestId is omitted', async () => {
    mockCreate.mockResolvedValue({} as never)
    mockGetRequestId.mockReturnValue('als-id')

    await recordAiUsage({
      householdId: 'h1',
      feature: 'recipe_parse',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
    })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestId: 'als-id' }),
    })
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ $ai_trace_id: 'als-id' }),
      }),
    )
  })

  it('writes null to the DB and undefined to PostHog when neither source provides an id', async () => {
    mockCreate.mockResolvedValue({} as never)
    // mockGetRequestId returns undefined by default (set in beforeEach).

    await recordAiUsage({
      householdId: 'h1',
      feature: 'recipe_parse',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
    })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestId: null }),
    })
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ $ai_trace_id: undefined }),
      }),
    )
  })
})

describe('recordAiUsage › missing usage counts', () => {
  it('writes the row, flags $ai_usage_missing on PostHog, and warns once naming feature and model', async () => {
    mockCreate.mockResolvedValue({} as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await recordAiUsage({
      householdId: 'h1',
      feature: 'plan_generate',
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      usageMissing: true,
    })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }),
    })
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $ai_usage_missing: true,
          $ai_total_cost_usd: 0,
        }),
      }),
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('plan_generate')
    expect(warn.mock.calls[0]![0]).toContain('claude-sonnet-4-6')
  })

  it('omits $ai_usage_missing and does not warn when usage is present', async () => {
    mockCreate.mockResolvedValue({} as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await recordAiUsage({
      householdId: 'h1',
      feature: 'plan_generate',
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000,
      outputTokens: 500,
      usageMissing: false,
    })

    const { properties } = mockCapture.mock.calls[0]![0] as { properties: Record<string, unknown> }
    expect(properties).not.toHaveProperty('$ai_usage_missing')
    expect(warn).not.toHaveBeenCalled()
  })

  it('still flags missing usage when PostHog is not configured', async () => {
    mockCreate.mockResolvedValue({} as never)
    mockGetPosthogServer.mockReturnValue(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await recordAiUsage({
      householdId: 'h1',
      feature: 'meal_imagine',
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      usageMissing: true,
    })

    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('withUsageOnFailure', () => {
  const MODEL = 'claude-sonnet-4-6'

  it('returns the result and reports nothing when the call succeeds', async () => {
    const onUsage = vi.fn()

    await expect(withUsageOnFailure(MODEL, onUsage, async () => 'ok')).resolves.toBe('ok')

    expect(onUsage).not.toHaveBeenCalled()
  })

  it('reports the error usage with success: false and rethrows the original NoObjectGeneratedError', async () => {
    const error = noObjectGeneratedError()
    const onUsage = vi.fn()

    await expect(withUsageOnFailure(MODEL, onUsage, () => Promise.reject(error))).rejects.toBe(
      error,
    )

    expect(onUsage).toHaveBeenCalledTimes(1)
    expect(onUsage).toHaveBeenCalledWith({ ...expectedUsageStats(MODEL), success: false })
  })

  it('reports usageMissing when the error carries no usage', async () => {
    const error = noObjectGeneratedError({ usage: undefined })
    const onUsage = vi.fn()

    await expect(withUsageOnFailure(MODEL, onUsage, () => Promise.reject(error))).rejects.toBe(
      error,
    )

    expect(onUsage).toHaveBeenCalledWith({
      model: MODEL,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      usageMissing: true,
      success: false,
    })
  })

  it.each([
    ['a network error', new Error('fetch failed')],
    ['a rate-limit error', Object.assign(new Error('rate limited'), { statusCode: 429 })],
    ['a timeout', Object.assign(new Error('timed out'), { name: 'TimeoutError' })],
    // Carries a `usage`, but is not a NoObjectGeneratedError — duck typing must not match.
    ['a look-alike error with usage', Object.assign(new Error('nope'), { usage: {} })],
  ])('reports nothing and rethrows unchanged on %s', async (_label, error) => {
    const onUsage = vi.fn()

    await expect(withUsageOnFailure(MODEL, onUsage, () => Promise.reject(error))).rejects.toBe(
      error,
    )

    expect(onUsage).not.toHaveBeenCalled()
  })

  it('rethrows without a callback', async () => {
    const error = noObjectGeneratedError()

    await expect(withUsageOnFailure(MODEL, undefined, () => Promise.reject(error))).rejects.toBe(
      error,
    )
  })

  it('still rethrows the original error when the callback throws', async () => {
    const error = noObjectGeneratedError()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      withUsageOnFailure(
        MODEL,
        () => {
          throw new Error('callback broke')
        },
        () => Promise.reject(error),
      ),
    ).rejects.toBe(error)
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('awaits an async callback before rethrowing', async () => {
    const error = noObjectGeneratedError()
    const order: string[] = []
    const onUsage = vi.fn(async () => {
      await Promise.resolve()
      order.push('recorded')
    })

    await withUsageOnFailure(MODEL, onUsage, () => Promise.reject(error)).catch(() =>
      order.push('rethrown'),
    )

    expect(order).toEqual(['recorded', 'rethrown'])
  })

  it('writes a success: false row that still carries the billed cost, and flags $ai_is_error', async () => {
    mockCreate.mockResolvedValue({} as never)
    const error = noObjectGeneratedError()

    await withUsageOnFailure(
      MODEL,
      (stats) => recordAiUsage({ householdId: 'h1', feature: 'plan_generate', ...stats }),
      () => Promise.reject(error),
    ).catch(() => {})

    const { data } = mockCreate.mock.calls[0]![0] as {
      data: { success: boolean; inputTokens: number; estimatedCostUsd: number }
    }
    expect(data.success).toBe(false)
    expect(data.inputTokens).toBe(expectedUsageStats(MODEL).inputTokens)
    // Counts toward the cap: a failed-validation call is not free.
    expect(data.estimatedCostUsd).toBeGreaterThan(0)
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ $ai_is_error: true }),
      }),
    )
  })
})
