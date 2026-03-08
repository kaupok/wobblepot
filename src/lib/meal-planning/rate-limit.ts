/**
 * Rate limiting for AI generation features.
 * Uses in-memory tracking for MVP (resets on server restart).
 * Can be migrated to DB-based tracking later if needed.
 */

export type RateLimitFeature = 'plan-generation' | 'meal-imagination'

const RATE_LIMITS: Record<RateLimitFeature, number> = {
  'plan-generation': 5,
  'meal-imagination': 50,
}

const HOUR_IN_MS = 60 * 60 * 1000

interface RateLimitEntry {
  timestamps: number[]
}

// In-memory store keyed by `${householdId}:${feature}` - resets on server restart
const rateLimitStore = new Map<string, RateLimitEntry>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt?: Date
}

/**
 * Check if a household can use a rate-limited feature.
 * Returns rate limit status without recording the attempt.
 */
export function checkRateLimit(householdId: string, feature: RateLimitFeature): RateLimitResult {
  const limit = RATE_LIMITS[feature]
  const now = Date.now()
  const cutoff = now - HOUR_IN_MS
  const key = `${householdId}:${feature}`

  const entry = rateLimitStore.get(key)
  if (!entry) {
    return { allowed: true, remaining: limit, limit }
  }

  // Filter to only timestamps within the last hour
  const recentTimestamps = entry.timestamps.filter((ts) => ts > cutoff)
  const count = recentTimestamps.length

  if (count >= limit) {
    // Find when the oldest timestamp in the window will expire
    const oldestInWindow = Math.min(...recentTimestamps)
    const resetAt = new Date(oldestInWindow + HOUR_IN_MS)
    return { allowed: false, remaining: 0, limit, resetAt }
  }

  return { allowed: true, remaining: limit - count, limit }
}

/**
 * Record a generation attempt for a household feature.
 * Call this after successful generation.
 */
export function recordGeneration(householdId: string, feature: RateLimitFeature): void {
  const now = Date.now()
  const cutoff = now - HOUR_IN_MS
  const key = `${householdId}:${feature}`

  const entry = rateLimitStore.get(key)
  if (!entry) {
    rateLimitStore.set(key, { timestamps: [now] })
    return
  }

  // Clean up old timestamps and add new one
  entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff)
  entry.timestamps.push(now)
}

/**
 * Clear rate limit data for a household feature.
 * Useful for testing.
 */
export function clearRateLimit(householdId: string, feature: RateLimitFeature): void {
  rateLimitStore.delete(`${householdId}:${feature}`)
}

/**
 * Clear all rate limit data.
 * Useful for testing.
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear()
}
