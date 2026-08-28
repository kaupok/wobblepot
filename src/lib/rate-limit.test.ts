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

// Short-circuit `@/lib/upstash` so loading `rate-limit.ts` does NOT pull in
// `@/lib/env`. Otherwise clientEnv's IIFE would throw on the "unset" and
// "unknown env" cases below before the rate-limit guard could fire, making
// it impossible to unit-test the guard's rejection path directly.
vi.mock('@/lib/upstash', () => ({
  getRedis: () => ({ __mockRedis: true }),
}))

// Same reason as `@/lib/upstash` above: the real `@/lib/errors` pulls in
// `@/lib/posthog-server` → `@/lib/env`, whose module-level validation would
// throw before the env-guard cases below could assert on the guard itself.
const mockCaptureApiError = vi.fn()
vi.mock('@/lib/errors', () => ({
  captureApiError: (...args: unknown[]) => mockCaptureApiError(...args),
}))

// Import AFTER mocks so they take effect.
const { retryAfterSeconds, RATE_LIMIT_CONFIG } = await import('./rate-limit')

describe('rate-limit', () => {
  beforeEach(() => {
    mockLimit.mockReset()
    ratelimitConstructor.mockReset()
    redisConstructor.mockReset()
    mockCaptureApiError.mockReset()
    // Drop module cache for limiterCache between tests.
    vi.resetModules()
    // Default: never bypass. Individual tests in the bypass describe block
    // opt in explicitly. This guards against ambient `E2E_DISABLE_RATE_LIMIT`
    // in the shell (local dev) or leaked from a parent CI env.
    delete process.env.E2E_DISABLE_RATE_LIMIT
  })

  describe('CONFIG', () => {
    it('covers all AI + auth + export features', () => {
      expect(Object.keys(RATE_LIMIT_CONFIG).sort()).toEqual([
        'data-export',
        'forgot-password',
        'meal-imagination',
        'meal-prep-tips',
        'meal-suggestions',
        'plan-generation',
        'recipe-parse',
        'sign-in',
        'sign-up',
      ])
    })

    it('configures data-export at 3/day per user', () => {
      expect(RATE_LIMIT_CONFIG['data-export']).toEqual({
        limit: 3,
        window: '1 d',
        dimension: 'user',
      })
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

    it('configures auth features with ip dimension and dual windows', () => {
      expect(RATE_LIMIT_CONFIG['sign-up']).toEqual({
        limit: 5,
        window: '1 h',
        dimension: 'ip',
        daily: { limit: 20, window: '1 d' },
      })
      expect(RATE_LIMIT_CONFIG['sign-in']).toEqual({
        limit: 20,
        window: '1 h',
        dimension: 'ip',
        daily: { limit: 100, window: '1 d' },
      })
      expect(RATE_LIMIT_CONFIG['forgot-password']).toEqual({
        limit: 3,
        window: '1 h',
        dimension: 'ip',
        daily: { limit: 5, window: '1 d' },
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

    it('uses a user-dimension prefix for data-export', async () => {
      const { checkRateLimit: fresh } = await import('./rate-limit')
      mockLimit.mockResolvedValue({
        success: true,
        limit: 3,
        remaining: 2,
        reset: Date.now() + 86_400_000,
      })

      await fresh('user-abc', 'data-export')

      expect(ratelimitConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: 'ratelimit:user:data-export' }),
      )
      expect(mockLimit).toHaveBeenCalledWith('ratelimit:user:data-export', 'user-abc')
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

    // An Upstash outage used to throw straight out of
    // `/api/auth/[...all]`, so sign-in, sign-up, and password reset all
    // returned a bare 500 for ~2.5 months. Rate limiting is abuse protection,
    // not an auth dependency — it must degrade, not take auth down.
    describe('Redis failure (fail-open)', () => {
      const REDIS_DOWN = new Error('WRONGPASS invalid or missing auth token')

      it('allows the request and flags it degraded when the limiter throws', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        mockLimit.mockRejectedValue(REDIS_DOWN)

        const result = await fresh('1.2.3.4', 'sign-in')

        expect(result.allowed).toBe(true)
        expect(result.degraded).toBe(true)
      })

      it('reports the failure to PostHog with the feature name', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        mockLimit.mockRejectedValue(REDIS_DOWN)

        await fresh('1.2.3.4', 'sign-in')

        expect(mockCaptureApiError).toHaveBeenCalledWith(
          REDIS_DOWN,
          expect.objectContaining({ route: 'rate-limit', feature: 'sign-in', degraded: true }),
        )
      })

      it('fails open when the daily window throws but the primary allowed', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        mockLimit
          .mockResolvedValueOnce({
            success: true,
            limit: 20,
            remaining: 19,
            reset: Date.now() + 60_000,
          })
          .mockRejectedValueOnce(REDIS_DOWN)

        const result = await fresh('1.2.3.4', 'sign-in')

        expect(result.allowed).toBe(true)
        expect(result.degraded).toBe(true)
      })

      // The important half of "fail open": a limiter that *answers* with a
      // denial is a real rate-limit hit and must keep denying.
      it('still denies when the limiter returns success: false', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        mockLimit.mockResolvedValue({
          success: false,
          limit: 20,
          remaining: 0,
          reset: Date.now() + 60_000,
        })

        const result = await fresh('1.2.3.4', 'sign-in')

        expect(result.allowed).toBe(false)
        expect(result.degraded).toBeUndefined()
        expect(mockCaptureApiError).not.toHaveBeenCalled()
      })

      it('does not mark a normally-allowed request as degraded', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        mockLimit.mockResolvedValue({
          success: true,
          limit: 20,
          remaining: 19,
          reset: Date.now() + 60_000,
        })

        const result = await fresh('1.2.3.4', 'sign-in')

        expect(result.allowed).toBe(true)
        expect(result.degraded).toBeUndefined()
      })

      // A Redis outage on a hot endpoint would otherwise emit one exception
      // per request.
      it('throttles reporting to once per feature per window', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        mockLimit.mockRejectedValue(REDIS_DOWN)

        await fresh('1.2.3.4', 'sign-in')
        await fresh('5.6.7.8', 'sign-in')
        await fresh('9.9.9.9', 'sign-in')

        expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
      })

      it('reports each affected feature separately', async () => {
        const { checkRateLimit: fresh, __resetRateLimitReportThrottle } =
          await import('./rate-limit')
        __resetRateLimitReportThrottle()
        mockLimit.mockRejectedValue(REDIS_DOWN)

        await fresh('1.2.3.4', 'sign-in')
        await fresh('1.2.3.4', 'sign-up')

        expect(mockCaptureApiError).toHaveBeenCalledTimes(2)
      })
    })

    describe('dual-window (features with a daily limit)', () => {
      it('builds both primary and daily limiters with distinct prefixes', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        mockLimit.mockResolvedValue({
          success: true,
          limit: 5,
          remaining: 4,
          reset: Date.now() + 60_000,
        })

        await fresh('1.2.3.4', 'sign-up')

        const prefixes = ratelimitConstructor.mock.calls.map(([opts]) => opts.prefix).sort()
        expect(prefixes).toEqual(['ratelimit:ip:sign-up', 'ratelimit:ip:sign-up:daily'])
      })

      it('returns primary result when both limiters allow', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        const primaryReset = Date.now() + 60_000
        const dailyReset = Date.now() + 3_600_000

        mockLimit.mockImplementation(async (prefix: string) => {
          if (prefix.endsWith(':daily')) {
            return { success: true, limit: 20, remaining: 19, reset: dailyReset }
          }
          return { success: true, limit: 5, remaining: 4, reset: primaryReset }
        })

        const result = await fresh('1.2.3.4', 'sign-up')

        expect(result).toEqual({
          allowed: true,
          limit: 5,
          remaining: 4,
          resetAt: new Date(primaryReset),
        })
      })

      it('returns daily result when primary allows but daily denies', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        const primaryReset = Date.now() + 60_000
        const dailyReset = Date.now() + 3_600_000

        mockLimit.mockImplementation(async (prefix: string) => {
          if (prefix.endsWith(':daily')) {
            return { success: false, limit: 20, remaining: 0, reset: dailyReset }
          }
          return { success: true, limit: 5, remaining: 4, reset: primaryReset }
        })

        const result = await fresh('1.2.3.4', 'sign-up')

        expect(result).toEqual({
          allowed: false,
          limit: 20,
          remaining: 0,
          resetAt: new Date(dailyReset),
        })
      })

      it('does not consult the daily limiter when the primary denies', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        const primaryReset = Date.now() + 60_000

        mockLimit.mockImplementation(async (prefix: string) => {
          if (prefix.endsWith(':daily')) {
            throw new Error('daily limiter must not be called when primary denies')
          }
          return { success: false, limit: 5, remaining: 0, reset: primaryReset }
        })

        const result = await fresh('1.2.3.4', 'sign-up')

        expect(result.allowed).toBe(false)
        expect(result.limit).toBe(5)
        const dailyCalls = mockLimit.mock.calls.filter(([prefix]) =>
          (prefix as string).endsWith(':daily'),
        )
        expect(dailyCalls).toHaveLength(0)
      })

      it('skips the daily limiter entirely for features without a daily config', async () => {
        const { checkRateLimit: fresh } = await import('./rate-limit')
        mockLimit.mockResolvedValue({
          success: true,
          limit: 5,
          remaining: 4,
          reset: Date.now() + 60_000,
        })

        await fresh('household-1', 'plan-generation')

        const prefixes = ratelimitConstructor.mock.calls.map(([opts]) => opts.prefix)
        expect(prefixes).toEqual(['ratelimit:household:plan-generation'])
      })
    })
  })

  describe('E2E_DISABLE_RATE_LIMIT bypass', () => {
    const originalFlag = process.env.E2E_DISABLE_RATE_LIMIT
    const originalEnv = process.env.NEXT_PUBLIC_APP_ENV

    beforeEach(() => {
      // Each test must load the module fresh so the module-init guard re-runs
      // against the env it just set. vi.resetModules() in the outer beforeEach
      // already does this; we just need to restore env between tests.
      // Conditional delete avoids Node coercing `undefined` to the literal
      // string "undefined" in process.env when the captured value was unset.
      if (originalFlag === undefined) delete process.env.E2E_DISABLE_RATE_LIMIT
      else process.env.E2E_DISABLE_RATE_LIMIT = originalFlag

      if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV
      else process.env.NEXT_PUBLIC_APP_ENV = originalEnv
    })

    it('short-circuits to allowed=true when enabled in ci', async () => {
      process.env.E2E_DISABLE_RATE_LIMIT = '1'
      process.env.NEXT_PUBLIC_APP_ENV = 'ci'

      const { checkRateLimit: fresh } = await import('./rate-limit')

      const result = await fresh('1.2.3.4', 'sign-up')

      expect(result.allowed).toBe(true)
      expect(mockLimit).not.toHaveBeenCalled()
    })

    it('throws at module init when enabled in production', async () => {
      process.env.E2E_DISABLE_RATE_LIMIT = '1'
      process.env.NEXT_PUBLIC_APP_ENV = 'production'

      await expect(import('./rate-limit')).rejects.toThrow(
        /E2E_DISABLE_RATE_LIMIT must not be set when NEXT_PUBLIC_APP_ENV=production/,
      )
    })

    it('throws at module init when enabled in staging', async () => {
      process.env.E2E_DISABLE_RATE_LIMIT = '1'
      process.env.NEXT_PUBLIC_APP_ENV = 'staging'

      await expect(import('./rate-limit')).rejects.toThrow(
        /E2E_DISABLE_RATE_LIMIT must not be set when NEXT_PUBLIC_APP_ENV=staging/,
      )
    })

    it('throws at module init when enabled in preview', async () => {
      process.env.E2E_DISABLE_RATE_LIMIT = '1'
      process.env.NEXT_PUBLIC_APP_ENV = 'preview'

      await expect(import('./rate-limit')).rejects.toThrow(
        /E2E_DISABLE_RATE_LIMIT must not be set when NEXT_PUBLIC_APP_ENV=preview/,
      )
    })

    it('throws at module init when enabled with NEXT_PUBLIC_APP_ENV unset', async () => {
      process.env.E2E_DISABLE_RATE_LIMIT = '1'
      delete process.env.NEXT_PUBLIC_APP_ENV

      await expect(import('./rate-limit')).rejects.toThrow(
        /E2E_DISABLE_RATE_LIMIT must not be set when NEXT_PUBLIC_APP_ENV=unset/,
      )
    })

    it('throws at module init when enabled with an unrecognised env value', async () => {
      process.env.E2E_DISABLE_RATE_LIMIT = '1'
      process.env.NEXT_PUBLIC_APP_ENV = 'typo-env'

      await expect(import('./rate-limit')).rejects.toThrow(
        /E2E_DISABLE_RATE_LIMIT must not be set when NEXT_PUBLIC_APP_ENV=typo-env/,
      )
    })

    it('does not bypass when flag is unset', async () => {
      delete process.env.E2E_DISABLE_RATE_LIMIT
      process.env.NEXT_PUBLIC_APP_ENV = 'ci'

      const { checkRateLimit: fresh } = await import('./rate-limit')
      mockLimit.mockResolvedValue({
        success: true,
        limit: 5,
        remaining: 4,
        reset: Date.now() + 60_000,
      })

      await fresh('1.2.3.4', 'sign-up')

      expect(mockLimit).toHaveBeenCalled()
    })

    it('does not bypass when flag is "0" or "false"', async () => {
      process.env.E2E_DISABLE_RATE_LIMIT = '0'
      process.env.NEXT_PUBLIC_APP_ENV = 'ci'

      const { checkRateLimit: fresh } = await import('./rate-limit')
      mockLimit.mockResolvedValue({
        success: true,
        limit: 5,
        remaining: 4,
        reset: Date.now() + 60_000,
      })

      await fresh('1.2.3.4', 'sign-up')

      expect(mockLimit).toHaveBeenCalled()
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
