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
      const result = checkRateLimit('household-1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
      expect(result.resetAt).toBeUndefined()
    })

    it('returns correct remaining count after generations', () => {
      const householdId = 'household-2'

      recordGeneration(householdId)
      expect(checkRateLimit(householdId).remaining).toBe(4)

      recordGeneration(householdId)
      expect(checkRateLimit(householdId).remaining).toBe(3)

      recordGeneration(householdId)
      expect(checkRateLimit(householdId).remaining).toBe(2)
    })

    it('blocks after 5 generations', () => {
      const householdId = 'household-3'

      for (let i = 0; i < 5; i++) {
        recordGeneration(householdId)
      }

      const result = checkRateLimit(householdId)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.resetAt).toBeDefined()
    })

    it('provides correct resetAt time', () => {
      const householdId = 'household-4'
      const now = new Date('2025-01-15T10:00:00.000Z')
      vi.setSystemTime(now)

      recordGeneration(householdId)

      // Fill up the rate limit
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(1000) // 1 second
        recordGeneration(householdId)
      }

      const result = checkRateLimit(householdId)
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
        recordGeneration(householdId)
      }

      expect(checkRateLimit(householdId).allowed).toBe(false)

      // Advance time by 1 hour + 1 second
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000)

      const result = checkRateLimit(householdId)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
    })

    it('cleans up old timestamps on check', () => {
      const householdId = 'household-6'
      const now = new Date('2025-01-15T10:00:00.000Z')
      vi.setSystemTime(now)

      // Record 3 generations
      for (let i = 0; i < 3; i++) {
        recordGeneration(householdId)
        vi.advanceTimersByTime(1000)
      }

      // Advance time by 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000)

      // Record 2 more generations
      for (let i = 0; i < 2; i++) {
        recordGeneration(householdId)
        vi.advanceTimersByTime(1000)
      }

      // Should only count the 2 recent generations
      const result = checkRateLimit(householdId)
      expect(result.remaining).toBe(3)
    })

    it('isolates rate limits between households', () => {
      const household1 = 'household-7a'
      const household2 = 'household-7b'

      // Fill up household1's rate limit
      for (let i = 0; i < 5; i++) {
        recordGeneration(household1)
      }

      expect(checkRateLimit(household1).allowed).toBe(false)
      expect(checkRateLimit(household2).allowed).toBe(true)
      expect(checkRateLimit(household2).remaining).toBe(5)
    })
  })

  describe('recordGeneration', () => {
    it('creates new entry for new household', () => {
      const householdId = 'household-8'

      expect(checkRateLimit(householdId).remaining).toBe(5)
      recordGeneration(householdId)
      expect(checkRateLimit(householdId).remaining).toBe(4)
    })

    it('adds to existing entry', () => {
      const householdId = 'household-9'

      recordGeneration(householdId)
      recordGeneration(householdId)
      recordGeneration(householdId)

      expect(checkRateLimit(householdId).remaining).toBe(2)
    })

    it('cleans up old timestamps on record', () => {
      const householdId = 'household-10'
      const now = new Date('2025-01-15T10:00:00.000Z')
      vi.setSystemTime(now)

      // Record 5 generations (rate limit reached)
      for (let i = 0; i < 5; i++) {
        recordGeneration(householdId)
      }

      // Advance time past the window
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000)

      // Record new generation - should clean up old ones
      recordGeneration(householdId)

      // Should only have 1 generation in current window
      expect(checkRateLimit(householdId).remaining).toBe(4)
    })
  })

  describe('clearRateLimit', () => {
    it('clears rate limit for specific household', () => {
      const household1 = 'household-11a'
      const household2 = 'household-11b'

      // Fill up both households
      for (let i = 0; i < 5; i++) {
        recordGeneration(household1)
        recordGeneration(household2)
      }

      expect(checkRateLimit(household1).allowed).toBe(false)
      expect(checkRateLimit(household2).allowed).toBe(false)

      clearRateLimit(household1)

      expect(checkRateLimit(household1).allowed).toBe(true)
      expect(checkRateLimit(household1).remaining).toBe(5)
      expect(checkRateLimit(household2).allowed).toBe(false)
    })

    it('does nothing for non-existent household', () => {
      expect(() => clearRateLimit('non-existent')).not.toThrow()
    })
  })

  describe('clearAllRateLimits', () => {
    it('clears all rate limits', () => {
      const household1 = 'household-12a'
      const household2 = 'household-12b'

      for (let i = 0; i < 5; i++) {
        recordGeneration(household1)
        recordGeneration(household2)
      }

      expect(checkRateLimit(household1).allowed).toBe(false)
      expect(checkRateLimit(household2).allowed).toBe(false)

      clearAllRateLimits()

      expect(checkRateLimit(household1).allowed).toBe(true)
      expect(checkRateLimit(household2).allowed).toBe(true)
    })
  })
})
