// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLimit = vi.fn()
const ratelimitConstructor = vi.fn()
const redisConstructor = vi.fn()

vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    constructor(opts: { url: string; token: string }) {
      redisConstructor(opts)
      Object.assign(this, { __mockRedis: true, ...opts })
    }
  },
}))

vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    prefix: string
    constructor(opts: { prefix: string }) {
      ratelimitConstructor(opts)
      this.prefix = opts.prefix
    }
    limit(identifier: string) {
      return mockLimit(this.prefix, identifier)
    }
    static slidingWindow(limit: number, window: string) {
      return { __kind: 'sliding', limit, window }
    }
  }
  return { Ratelimit }
})

// Import AFTER mocks so they take effect.
const { retryAfterSeconds, RATE_LIMIT_CONFIG } = await import('./rate-limit')

describe('rate-limit', () => {
  beforeEach(() => {
    mockLimit.mockReset()
    ratelimitConstructor.mockReset()
    redisConstructor.mockReset()
    // Drop module cache for limiterCache between tests.
    vi.resetModules()
  })

  describe('CONFIG', () => {
    it('covers all five AI-gated features', () => {
      expect(Object.keys(RATE_LIMIT_CONFIG).sort()).toEqual([
        'meal-imagination',
        'meal-prep-tips',
        'meal-suggestions',
        'plan-generation',
        'recipe-parse',
      ])
    })

    it('preserves existing household limits for plan-generation and meal-imagination', () => {
      expect(RATE_LIMIT_CONFIG['plan-generation']).toMatchObject({
        limit: 5,
        window: '1 h',
        dimension: 'household',
      })
      expect(RATE_LIMIT_CONFIG['meal-imagination']).toMatchObject({
        limit: 50,
        window: '1 h',
        dimension: 'household',
      })
    })
  })

  describe('checkRateLimit', () => {
    it('builds a Ratelimit with key prefix ratelimit:{dimension}:{feature}', async () => {
      const { checkRateLimit: fresh } = await import('./rate-limit')
      mockLimit.mockResolvedValue({
        success: true,
        limit: 5,
        remaining: 4,
        reset: Date.now() + 60_000,
      })

      await fresh('household-abc', 'plan-generation')

      expect(ratelimitConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: 'ratelimit:household:plan-generation' }),
      )
    })

    it('passes the raw identifier to the limiter (identifier is not mangled)', async () => {
      const { checkRateLimit: fresh } = await import('./rate-limit')
      mockLimit.mockResolvedValue({
        success: true,
        limit: 5,
        remaining: 4,
        reset: Date.now() + 60_000,
      })

      await fresh('household-xyz', 'plan-generation')

      expect(mockLimit).toHaveBeenCalledWith('ratelimit:household:plan-generation', 'household-xyz')
    })

    it('reuses the same limiter instance across calls to the same feature', async () => {
      const { checkRateLimit: fresh } = await import('./rate-limit')
      mockLimit.mockResolvedValue({
        success: true,
        limit: 50,
        remaining: 49,
        reset: Date.now() + 60_000,
      })

      await fresh('h-1', 'meal-imagination')
      await fresh('h-2', 'meal-imagination')

      const mealImaginationCalls = ratelimitConstructor.mock.calls.filter(
        ([opts]) => opts.prefix === 'ratelimit:household:meal-imagination',
      )
      expect(mealImaginationCalls).toHaveLength(1)
    })

    it('builds separate limiters per feature so dimensions do not collide', async () => {
      const { checkRateLimit: fresh } = await import('./rate-limit')
      mockLimit.mockResolvedValue({
        success: true,
        limit: 5,
        remaining: 4,
        reset: Date.now() + 60_000,
      })

      await fresh('x', 'plan-generation')
      await fresh('x', 'meal-imagination')
      await fresh('x', 'recipe-parse')

      const prefixes = ratelimitConstructor.mock.calls.map(([opts]) => opts.prefix).sort()
      expect(prefixes).toEqual([
        'ratelimit:household:meal-imagination',
        'ratelimit:household:plan-generation',
        'ratelimit:household:recipe-parse',
      ])
    })

    it('maps success→allowed and reset→Date in the result', async () => {
      const { checkRateLimit: fresh } = await import('./rate-limit')
      const resetMs = Date.UTC(2026, 5, 1, 12, 0, 0)
      mockLimit.mockResolvedValue({
        success: false,
        limit: 5,
        remaining: 0,
        reset: resetMs,
      })

      const result = await fresh('h-1', 'plan-generation')

      expect(result).toEqual({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: new Date(resetMs),
      })
    })
  })

  describe('retryAfterSeconds', () => {
    it('returns seconds until reset, ceiling', () => {
      const now = new Date('2026-04-19T12:00:00.000Z')
      vi.setSystemTime(now)

      const result = retryAfterSeconds({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: new Date(now.getTime() + 2_500),
      })

      expect(result).toBe(3)
      vi.useRealTimers()
    })

    it('floors at 1 when reset is already past', () => {
      const now = new Date('2026-04-19T12:00:00.000Z')
      vi.setSystemTime(now)

      const result = retryAfterSeconds({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: new Date(now.getTime() - 10_000),
      })

      expect(result).toBe(1)
      vi.useRealTimers()
    })
  })
})
