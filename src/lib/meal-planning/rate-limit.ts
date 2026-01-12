/**
 * Rate limiting for meal plan generation.
 * Uses in-memory tracking for MVP (resets on server restart).
 * Can be migrated to DB-based tracking later if needed.
 */

const RATE_LIMIT_PER_HOUR = 5
const HOUR_IN_MS = 60 * 60 * 1000

interface RateLimitEntry {
  timestamps: number[]
}

// In-memory store - resets on server restart
const rateLimitStore = new Map<string, RateLimitEntry>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt?: Date
}

/**
 * Check if a household can generate a meal plan.
 * Returns rate limit status without recording the attempt.
 */
export function checkRateLimit(householdId: string): RateLimitResult {
  const now = Date.now()
  const cutoff = now - HOUR_IN_MS

  const entry = rateLimitStore.get(householdId)
  if (!entry) {
    return { allowed: true, remaining: RATE_LIMIT_PER_HOUR }
  }

  // Filter to only timestamps within the last hour
  const recentTimestamps = entry.timestamps.filter((ts) => ts > cutoff)
  const count = recentTimestamps.length

  if (count >= RATE_LIMIT_PER_HOUR) {
    // Find when the oldest timestamp in the window will expire
    const oldestInWindow = Math.min(...recentTimestamps)
    const resetAt = new Date(oldestInWindow + HOUR_IN_MS)
    return { allowed: false, remaining: 0, resetAt }
  }

  return { allowed: true, remaining: RATE_LIMIT_PER_HOUR - count }
}

/**
 * Record a generation attempt for a household.
 * Call this after successful generation.
 */
export function recordGeneration(householdId: string): void {
  const now = Date.now()
  const cutoff = now - HOUR_IN_MS

  const entry = rateLimitStore.get(householdId)
  if (!entry) {
    rateLimitStore.set(householdId, { timestamps: [now] })
    return
  }

  // Clean up old timestamps and add new one
  entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff)
  entry.timestamps.push(now)
}

/**
 * Clear rate limit data for a household.
 * Useful for testing.
 */
export function clearRateLimit(householdId: string): void {
  rateLimitStore.delete(householdId)
}

/**
 * Clear all rate limit data.
 * Useful for testing.
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear()
}
