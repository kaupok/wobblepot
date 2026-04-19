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
 */

import { Ratelimit, type Duration } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { serverEnv } from '@/lib/env'

export type RateLimitFeature =
  | 'plan-generation'
  | 'meal-imagination'
  | 'recipe-parse'
  | 'meal-prep-tips'
  | 'meal-suggestions'

type Dimension = 'household' | 'ip'

interface FeatureConfig {
  limit: number
  window: Duration
  dimension: Dimension
}

export const RATE_LIMIT_CONFIG: Record<RateLimitFeature, FeatureConfig> = {
  'plan-generation': { limit: 5, window: '1 h', dimension: 'household' },
  'meal-imagination': { limit: 50, window: '1 h', dimension: 'household' },
  'recipe-parse': { limit: 20, window: '1 h', dimension: 'household' },
  'meal-prep-tips': { limit: 30, window: '1 h', dimension: 'household' },
  'meal-suggestions': { limit: 60, window: '1 h', dimension: 'household' },
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: Date
}

let redisSingleton: Redis | null = null

function getRedis(): Redis {
  if (!redisSingleton) {
    redisSingleton = new Redis({
      url: serverEnv.UPSTASH_REDIS_REST_URL,
      token: serverEnv.UPSTASH_REDIS_REST_TOKEN,
    })
  }
  return redisSingleton
}

const limiterCache = new Map<RateLimitFeature, Ratelimit>()

function getLimiter(feature: RateLimitFeature): Ratelimit {
  const cached = limiterCache.get(feature)
  if (cached) return cached

  const cfg = RATE_LIMIT_CONFIG[feature]
  const limiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
    // Keys become `ratelimit:{dimension}:{feature}:{identifier}`
    prefix: `ratelimit:${cfg.dimension}:${feature}`,
    analytics: false,
  })
  limiterCache.set(feature, limiter)
  return limiter
}

/**
 * Atomically check whether an identifier is allowed to make a request for
 * a given feature. This both checks *and* records — do NOT call a second
 * method to "commit" the request; that shape existed only for the old
 * in-memory implementation.
 *
 * @param identifier - Caller-supplied opaque string (e.g. `household.id`, IP).
 *                     Paired with the feature's dimension to form the Redis key.
 */
export async function checkRateLimit(
  identifier: string,
  feature: RateLimitFeature,
): Promise<RateLimitResult> {
  const limiter = getLimiter(feature)
  const result = await limiter.limit(identifier)
  return {
    allowed: result.success,
    limit: result.limit,
    remaining: result.remaining,
    resetAt: new Date(result.reset),
  }
}

/**
 * Seconds until the rate-limit window resets, suitable for the HTTP
 * `Retry-After` response header. Always at least 1.
 */
export function retryAfterSeconds(result: RateLimitResult): number {
  const seconds = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
  return Math.max(1, seconds)
}
