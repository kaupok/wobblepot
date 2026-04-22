/**
 * Rate limiting for AI and abuse-sensitive endpoints.
 *
 * Backed by Upstash Redis via `@upstash/ratelimit`. The sliding-window
 * algorithm atomically checks and records each request in a single round-trip,
 * so concurrent calls from the same identifier cannot bypass the cap.
 *
 * Identifier is caller-supplied (household id, IP address, etc.). The
 * dimension is encoded in the Redis key prefix per feature so that
 * `household:X` and `ip:X` can never collide.
 *
 * Features may optionally declare a `daily` limit in addition to the primary
 * (typically hourly) limit. When both are declared, `checkRateLimit` consults
 * the primary first; if it allows, the daily limiter is consulted too. The
 * caller sees a single result that reflects whichever limiter blocked (or the
 * primary's result when both allow). The daily limiter uses a distinct Redis
 * key prefix so its counter never collides with the primary.
 */

import { Ratelimit, type Duration } from '@upstash/ratelimit'
import { getRedis } from '@/lib/upstash'

// E2E bypass: allows CI to skip the IP-dimensioned rate limiter that would
// otherwise trip on the shared GitHub-runner IP after ~5 sign-ups. Refuses
// to activate in production / staging so a misconfigured deploy fails loudly
// at module init instead of silently weakening auth-endpoint protection.
//
// Enable with `E2E_DISABLE_RATE_LIMIT=1` (or `true`) in CI only.
function resolveBypass(): boolean {
  const raw = process.env.E2E_DISABLE_RATE_LIMIT
  const enabled = raw === '1' || raw === 'true'
  if (!enabled) return false

  const env = process.env.NEXT_PUBLIC_APP_ENV
  if (env === 'production' || env === 'staging') {
    throw new Error(
      `E2E_DISABLE_RATE_LIMIT must not be set when NEXT_PUBLIC_APP_ENV=${env}. ` +
        `This flag weakens abuse protection and is only permitted in ci/test/dev.`,
    )
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[rate-limit] E2E_DISABLE_RATE_LIMIT is active (NEXT_PUBLIC_APP_ENV=${env ?? 'unset'}). ` +
      `Rate limiting is DISABLED — do not deploy this config to any user-facing environment.`,
  )
  return true
}

const BYPASS_ACTIVE = resolveBypass()

export type RateLimitFeature =
  | 'plan-generation'
  | 'meal-imagination'
  | 'recipe-parse'
  | 'meal-prep-tips'
  | 'meal-suggestions'
  | 'sign-up'
  | 'sign-in'
  | 'forgot-password'
  | 'data-export'

type Dimension = 'household' | 'ip' | 'user'

interface WindowConfig {
  limit: number
  window: Duration
}

interface FeatureConfig extends WindowConfig {
  dimension: Dimension
  daily?: WindowConfig
}

export const RATE_LIMIT_CONFIG: Record<RateLimitFeature, FeatureConfig> = {
  'plan-generation': { limit: 5, window: '1 h', dimension: 'household' },
  'meal-imagination': { limit: 50, window: '1 h', dimension: 'household' },
  'recipe-parse': { limit: 20, window: '1 h', dimension: 'household' },
  'meal-prep-tips': { limit: 30, window: '1 h', dimension: 'household' },
  'meal-suggestions': { limit: 60, window: '1 h', dimension: 'household' },
  'sign-up': {
    limit: 5,
    window: '1 h',
    dimension: 'ip',
    daily: { limit: 20, window: '1 d' },
  },
  'sign-in': {
    limit: 20,
    window: '1 h',
    dimension: 'ip',
    daily: { limit: 100, window: '1 d' },
  },
  'forgot-password': {
    limit: 3,
    window: '1 h',
    dimension: 'ip',
    daily: { limit: 5, window: '1 d' },
  },
  'data-export': { limit: 3, window: '1 d', dimension: 'user' },
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: Date
}

type WindowSlot = 'primary' | 'daily'
type LimiterKey = `${RateLimitFeature}:${WindowSlot}`

const limiterCache = new Map<LimiterKey, Ratelimit>()

function buildLimiter(
  feature: RateLimitFeature,
  slot: WindowSlot,
  windowConfig: WindowConfig,
): Ratelimit {
  const cfg = RATE_LIMIT_CONFIG[feature]
  // Primary key shape preserved from HON-451 so existing counters don't reset.
  // Daily limiter gets a ':daily' suffix so the two counters never collide.
  const prefix =
    slot === 'primary'
      ? `ratelimit:${cfg.dimension}:${feature}`
      : `ratelimit:${cfg.dimension}:${feature}:daily`

  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(windowConfig.limit, windowConfig.window),
    prefix,
    analytics: false,
  })
}

function getLimiter(feature: RateLimitFeature, slot: WindowSlot): Ratelimit | null {
  const cacheKey: LimiterKey = `${feature}:${slot}`
  const cached = limiterCache.get(cacheKey)
  if (cached) return cached

  const cfg = RATE_LIMIT_CONFIG[feature]
  const windowConfig: WindowConfig | undefined =
    slot === 'primary' ? { limit: cfg.limit, window: cfg.window } : cfg.daily
  if (!windowConfig) return null

  const limiter = buildLimiter(feature, slot, windowConfig)
  limiterCache.set(cacheKey, limiter)
  return limiter
}

interface LimiterResponse {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

function toResult(response: LimiterResponse): RateLimitResult {
  return {
    allowed: response.success,
    limit: response.limit,
    remaining: response.remaining,
    resetAt: new Date(response.reset),
  }
}

/**
 * Atomically check whether an identifier is allowed to make a request for
 * a given feature. This both checks *and* records — do NOT call a second
 * method to "commit" the request; that shape existed only for the old
 * in-memory implementation.
 *
 * When a feature declares a `daily` window in addition to the primary, both
 * are consulted. The primary is checked first; if it denies, the daily
 * limiter is skipped (so a denied request is only charged against one window,
 * preserving the sliding-window atomicity guarantee per call). If the primary
 * allows but the daily denies, the returned result reflects the daily limit.
 *
 * @param identifier - Caller-supplied opaque string (e.g. `household.id`, IP).
 *                     Paired with the feature's dimension to form the Redis key.
 */
export async function checkRateLimit(
  identifier: string,
  feature: RateLimitFeature,
): Promise<RateLimitResult> {
  if (BYPASS_ACTIVE) {
    // eslint-disable-next-line no-console
    console.warn(`[rate-limit] bypassed: feature=${feature} identifier=${identifier}`)
    const cfg = RATE_LIMIT_CONFIG[feature]
    return {
      allowed: true,
      limit: cfg.limit,
      remaining: cfg.limit,
      resetAt: new Date(Date.now() + 60_000),
    }
  }

  const primary = getLimiter(feature, 'primary')
  // Primary always exists — this cast is safe because every feature has a
  // primary window by construction of RATE_LIMIT_CONFIG.
  const primaryResponse = (await primary!.limit(identifier)) as LimiterResponse
  if (!primaryResponse.success) {
    return toResult(primaryResponse)
  }

  const daily = getLimiter(feature, 'daily')
  if (daily) {
    const dailyResponse = (await daily.limit(identifier)) as LimiterResponse
    if (!dailyResponse.success) {
      return toResult(dailyResponse)
    }
  }

  return toResult(primaryResponse)
}

/**
 * Seconds until the rate-limit window resets, suitable for the HTTP
 * `Retry-After` response header. Always at least 1.
 */
export function retryAfterSeconds(result: RateLimitResult): number {
  const seconds = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
  return Math.max(1, seconds)
}
