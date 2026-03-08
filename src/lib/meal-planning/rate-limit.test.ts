import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { checkRateLimit, recordGeneration, clearRateLimit, clearAllRateLimits } from './rate-limit'

describe('rate-limit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearAllRateLimits()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('checkRateLimit', () => {
    it('allows first generation for new household', () => {
      const result = checkRateLimit('household-1', 'plan-generation')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
      expect(result.resetAt).toBeUndefined()
    })

    it('returns correct remaining count after generations', () => {
      const householdId = 'household-2'

      recordGeneration(householdId, 'plan-generation')
      expect(checkRateLimit(householdId, 'plan-generation').remaining).toBe(4)

      recordGeneration(householdId, 'plan-generation')
      expect(checkRateLimit(householdId, 'plan-generation').remaining).toBe(3)

      recordGeneration(householdId, 'plan-generation')
      expect(checkRateLimit(householdId, 'plan-generation').remaining).toBe(2)
    })

    it('blocks plan generation after 5 requests', () => {
      const householdId = 'household-3'

      for (let i = 0; i < 5; i++) {
        recordGeneration(householdId, 'plan-generation')
      }

      const result = checkRateLimit(householdId, 'plan-generation')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.resetAt).toBeDefined()
    })

    it('blocks meal imagination after 50 requests', () => {
      const householdId = 'household-3b'

      for (let i = 0; i < 50; i++) {
        recordGeneration(householdId, 'meal-imagination')
      }

      const result = checkRateLimit(householdId, 'meal-imagination')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.resetAt).toBeDefined()
    })

    it('provides correct resetAt time', () => {
      const householdId = 'household-4'
      const now = new Date('2025-01-15T10:00:00.000Z')
      vi.setSystemTime(now)

      recordGeneration(householdId, 'plan-generation')

      // Fill up the rate limit
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(1000) // 1 second
        recordGeneration(householdId, 'plan-generation')
      }

      const result = checkRateLimit(householdId, 'plan-generation')
      expect(result.allowed).toBe(false)
      expect(result.resetAt).toBeDefined()

      // resetAt should be ~1 hour after the first generation
      const expectedResetAt = new Date(now.getTime() + 60 * 60 * 1000)
      expect(result.resetAt!.getTime()).toBe(expectedResetAt.getTime())
    })

    it('allows generation after rate limit window expires', () => {
      const householdId = 'household-5'
      const now = new Date('2025-01-15T10:00:00.000Z')
      vi.setSystemTime(now)

      // Fill up the rate limit
      for (let i = 0; i < 5; i++) {
        recordGeneration(householdId, 'plan-generation')
      }

      expect(checkRateLimit(householdId, 'plan-generation').allowed).toBe(false)

      // Advance time by 1 hour + 1 second
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000)

      const result = checkRateLimit(householdId, 'plan-generation')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
    })

    it('cleans up old timestamps on check', () => {
      const householdId = 'household-6'
      const now = new Date('2025-01-15T10:00:00.000Z')
      vi.setSystemTime(now)

      // Record 3 generations
      for (let i = 0; i < 3; i++) {
        recordGeneration(householdId, 'plan-generation')
        vi.advanceTimersByTime(1000)
      }

      // Advance time by 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000)

      // Record 2 more generations
      for (let i = 0; i < 2; i++) {
        recordGeneration(householdId, 'plan-generation')
        vi.advanceTimersByTime(1000)
      }

      // Should only count the 2 recent generations
      const result = checkRateLimit(householdId, 'plan-generation')
      expect(result.remaining).toBe(3)
    })

    it('isolates rate limits between households', () => {
      const household1 = 'household-7a'
      const household2 = 'household-7b'

      // Fill up household1's rate limit
      for (let i = 0; i < 5; i++) {
        recordGeneration(household1, 'plan-generation')
      }

      expect(checkRateLimit(household1, 'plan-generation').allowed).toBe(false)
      expect(checkRateLimit(household2, 'plan-generation').allowed).toBe(true)
      expect(checkRateLimit(household2, 'plan-generation').remaining).toBe(5)
    })

    it('isolates rate limits between features', () => {
      const householdId = 'household-features'

      // Fill up plan-generation limit
      for (let i = 0; i < 5; i++) {
        recordGeneration(householdId, 'plan-generation')
      }

      // Plan generation should be blocked
      expect(checkRateLimit(householdId, 'plan-generation').allowed).toBe(false)

      // Meal imagination should still be available
      expect(checkRateLimit(householdId, 'meal-imagination').allowed).toBe(true)
      expect(checkRateLimit(householdId, 'meal-imagination').remaining).toBe(50)
    })

    it('uses correct limit per feature', () => {
      const householdId = 'household-limits'

      const planResult = checkRateLimit(householdId, 'plan-generation')
      expect(planResult.remaining).toBe(5)

      const imagineResult = checkRateLimit(householdId, 'meal-imagination')
      expect(imagineResult.remaining).toBe(50)
    })
  })

  describe('recordGeneration', () => {
    it('creates new entry for new household', () => {
      const householdId = 'household-8'

      expect(checkRateLimit(householdId, 'plan-generation').remaining).toBe(5)
      recordGeneration(householdId, 'plan-generation')
      expect(checkRateLimit(householdId, 'plan-generation').remaining).toBe(4)
    })

    it('adds to existing entry', () => {
      const householdId = 'household-9'

      recordGeneration(householdId, 'plan-generation')
      recordGeneration(householdId, 'plan-generation')
      recordGeneration(householdId, 'plan-generation')

      expect(checkRateLimit(householdId, 'plan-generation').remaining).toBe(2)
    })

    it('cleans up old timestamps on record', () => {
      const householdId = 'household-10'
      const now = new Date('2025-01-15T10:00:00.000Z')
      vi.setSystemTime(now)

      // Record 5 generations (rate limit reached)
      for (let i = 0; i < 5; i++) {
        recordGeneration(householdId, 'plan-generation')
      }

      // Advance time past the window
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000)

      // Record new generation - should clean up old ones
      recordGeneration(householdId, 'plan-generation')

      // Should only have 1 generation in current window
      expect(checkRateLimit(householdId, 'plan-generation').remaining).toBe(4)
    })
  })

  describe('clearRateLimit', () => {
    it('clears rate limit for specific household and feature', () => {
      const householdId = 'household-11'

      for (let i = 0; i < 5; i++) {
        recordGeneration(householdId, 'plan-generation')
        recordGeneration(householdId, 'meal-imagination')
      }

      expect(checkRateLimit(householdId, 'plan-generation').allowed).toBe(false)
      expect(checkRateLimit(householdId, 'meal-imagination').remaining).toBe(45)

      clearRateLimit(householdId, 'plan-generation')

      expect(checkRateLimit(householdId, 'plan-generation').allowed).toBe(true)
      expect(checkRateLimit(householdId, 'plan-generation').remaining).toBe(5)
      // Other feature unaffected
      expect(checkRateLimit(householdId, 'meal-imagination').remaining).toBe(45)
    })

    it('does nothing for non-existent household', () => {
      expect(() => clearRateLimit('non-existent', 'plan-generation')).not.toThrow()
    })
  })

  describe('clearAllRateLimits', () => {
    it('clears all rate limits', () => {
      const household1 = 'household-12a'
      const household2 = 'household-12b'

      for (let i = 0; i < 5; i++) {
        recordGeneration(household1, 'plan-generation')
        recordGeneration(household2, 'plan-generation')
      }

      expect(checkRateLimit(household1, 'plan-generation').allowed).toBe(false)
      expect(checkRateLimit(household2, 'plan-generation').allowed).toBe(false)

      clearAllRateLimits()

      expect(checkRateLimit(household1, 'plan-generation').allowed).toBe(true)
      expect(checkRateLimit(household2, 'plan-generation').allowed).toBe(true)
    })
  })
})
