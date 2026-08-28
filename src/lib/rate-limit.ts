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
import { captureApiError } from '@/lib/errors'

// E2E bypass: allows CI to skip the IP-dimensioned rate limiter that would
// otherwise trip on the shared GitHub-runner IP after ~5 sign-ups. Refuses
// to activate unless NEXT_PUBLIC_APP_ENV is explicitly one of SAFE_ENVS
// (ci / test / dev), so misconfigured deploys — production, staging,
// preview, unset, or typo — fail loudly at module init instead of silently
// weakening auth-endpoint protection.
//
// Exported so `src/lib/auth.ts` can also disable Better Auth's built-in
// IP rate limiter (3 sign-ups/sign-ins per 10 s, on by default in
// production) when our bypass is active — otherwise CI tests still trip
// it from the shared runner IP. See HON-520.
//
// Enable with `E2E_DISABLE_RATE_LIMIT=1` (or `true`) in CI only.
const SAFE_ENVS: ReadonlySet<string> = new Set(['ci', 'test', 'dev'])

function resolveBypass(): boolean {
  const raw = process.env.E2E_DISABLE_RATE_LIMIT
  const enabled = raw === '1' || raw === 'true'
  if (!enabled) return false

  const env = process.env.NEXT_PUBLIC_APP_ENV
  if (!env || !SAFE_ENVS.has(env)) {
    throw new Error(
      `E2E_DISABLE_RATE_LIMIT must not be set when NEXT_PUBLIC_APP_ENV=${env ?? 'unset'}. ` +
        `This flag weakens abuse protection and is only permitted in: ${[...SAFE_ENVS].join(', ')}.`,
    )
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[rate-limit] E2E_DISABLE_RATE_LIMIT is active (NEXT_PUBLIC_APP_ENV=${env}). ` +
      `Rate limiting is DISABLED — do not deploy this config to any user-facing environment.`,
  )
  return true
}

export const RATE_LIMIT_BYPASS_ACTIVE = resolveBypass()

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
  /**
   * Set when Redis was unreachable and the request was allowed through
   * *without* being counted (see {@link checkRateLimit}). Callers that care —
   * e.g. a surface that wants to refuse rather than run uncounted — can branch
   * on it; the auth route deliberately does not.
   */
  degraded?: boolean
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
 * Fail-open result used when Redis itself is unavailable. Deliberately NOT the
 * same as a bypass: `degraded` marks the request as uncounted so the caller and
 * `/status` can tell "allowed because under the limit" from "allowed because we
 * couldn't check".
 */
function degradedResult(feature: RateLimitFeature): RateLimitResult {
  const cfg = RATE_LIMIT_CONFIG[feature]
  return {
    allowed: true,
    limit: cfg.limit,
    remaining: cfg.limit,
    resetAt: new Date(Date.now() + 60_000),
    degraded: true,
  }
}

/** Last report timestamp per feature, for {@link reportLimiterFailure}. */
const lastReportedAt = new Map<RateLimitFeature, number>()
const REPORT_THROTTLE_MS = 60_000

/**
 * Report an Upstash failure to PostHog, at most once per minute per feature.
 *
 * A Redis outage on a hot endpoint would otherwise emit one exception per
 * request. `captureApiError` never throws, but keep the whole thing in a
 * try/catch anyway — reporting must not be able to convert a degraded
 * rate-limiter into a failed request.
 */
function reportLimiterFailure(feature: RateLimitFeature, error: unknown): void {
  try {
    const now = Date.now()
    const last = lastReportedAt.get(feature)
    if (last !== undefined && now - last < REPORT_THROTTLE_MS) return
    lastReportedAt.set(feature, now)

    // eslint-disable-next-line no-console
    console.error(
      `[rate-limit] Upstash unavailable for feature=${feature}; failing open (requests are NOT being counted)`,
      error,
    )
    captureApiError(error, { route: 'rate-limit', feature, degraded: true })
  } catch {
    // Swallow — see above.
  }
}

/** Test-only: clear the report throttle so cases don't leak into each other. */
export function __resetRateLimitReportThrottle(): void {
  lastReportedAt.clear()
}

/**
 * Run one limiter window, converting an *infrastructure* failure into a
 * fail-open result. Only thrown errors fail open — a limiter that returns
 * `success: false` is a real denial and must still deny.
 */
async function limitOrFailOpen(
  limiter: Ratelimit,
  identifier: string,
  feature: RateLimitFeature,
): Promise<LimiterResponse | 'degraded'> {
  try {
    return (await limiter.limit(identifier)) as LimiterResponse
  } catch (error) {
    reportLimiterFailure(feature, error)
    return 'degraded'
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
 * When Redis is unreachable (bad/rotated Upstash credentials, deleted database,
 * network error) the check **fails open**: the request is allowed with
 * `degraded: true` and the failure is reported to PostHog. Rate limiting is
 * abuse protection, not an authentication dependency — previously an Upstash
 * outage threw out of `/api/auth/[...all]` as a bare 500 and took sign-in,
 * sign-up, and password reset down with it. `probeRateLimit` in
 * `src/lib/status/probes.ts` is what surfaces the degraded state.
 *
 * @param identifier - Caller-supplied opaque string (e.g. `household.id`, IP).
 *                     Paired with the feature's dimension to form the Redis key.
 */
export async function checkRateLimit(
  identifier: string,
  feature: RateLimitFeature,
): Promise<RateLimitResult> {
  if (RATE_LIMIT_BYPASS_ACTIVE) {
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

  // Limiter construction reaches for `serverEnv.UPSTASH_REDIS_REST_*`, so it can
  // throw on a misconfigured deploy before any network call happens. Keep it
  // inside the fail-open boundary.
  let primary: Ratelimit | null
  let daily: Ratelimit | null
  try {
    primary = getLimiter(feature, 'primary')
    daily = getLimiter(feature, 'daily')
  } catch (error) {
    reportLimiterFailure(feature, error)
    return degradedResult(feature)
  }

  // Primary always exists — this non-null assertion is safe because every
  // feature has a primary window by construction of RATE_LIMIT_CONFIG.
  const primaryResponse = await limitOrFailOpen(primary!, identifier, feature)
  if (primaryResponse === 'degraded') {
    return degradedResult(feature)
  }
  if (!primaryResponse.success) {
    return toResult(primaryResponse)
  }

  if (daily) {
    const dailyResponse = await limitOrFailOpen(daily, identifier, feature)
    if (dailyResponse === 'degraded') {
      return degradedResult(feature)
    }
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
