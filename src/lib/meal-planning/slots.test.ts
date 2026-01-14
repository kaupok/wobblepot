import { describe, it, expect } from 'vitest'
import { computeRequiredSlots, pickDay, shouldEnforceBalanceConstraints } from './slots'

// Helper to create a week of dates starting from a given Monday
function createWeek(startDate: Date): Date[] {
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + i)
    dates.push(date)
  }
  return dates
}

// Monday Jan 6, 2025 (good test date - starts on Monday)
const MONDAY = new Date(2025, 0, 6)

describe('shouldEnforceBalanceConstraints', () => {
  it('returns true for 7 days', () => {
    expect(shouldEnforceBalanceConstraints(7)).toBe(true)
  })

  it('returns true for 5 days (threshold)', () => {
    expect(shouldEnforceBalanceConstraints(5)).toBe(true)
  })

  it('returns false for 4 days', () => {
    expect(shouldEnforceBalanceConstraints(4)).toBe(false)
  })

  it('returns false for 1 day', () => {
    expect(shouldEnforceBalanceConstraints(1)).toBe(false)
  })

  it('returns false for 0 days', () => {
    expect(shouldEnforceBalanceConstraints(0)).toBe(false)
  })
})

describe('pickDay', () => {
  const fullWeek = createWeek(MONDAY)

  it('picks Wednesday for midweek', () => {
    const result = pickDay(fullWeek, 'midweek')
    expect(result.getDay()).toBe(3) // Wednesday
  })

  it('picks Saturday for weekend', () => {
    const result = pickDay(fullWeek, 'weekend')
    expect(result.getDay()).toBe(6) // Saturday
  })

  it('picks Tuesday for early', () => {
    const result = pickDay(fullWeek, 'early')
    expect(result.getDay()).toBe(2) // Tuesday
  })

  it('picks Friday for late', () => {
    const result = pickDay(fullWeek, 'late')
    expect(result.getDay()).toBe(5) // Friday
  })

  it('falls back to first date when target day not found', () => {
    // Only Wed-Sun (no Monday or Tuesday)
    const partialWeek = fullWeek.slice(2) // Wed, Thu, Fri, Sat, Sun
    const result = pickDay(partialWeek, 'early') // Looking for Tuesday
    expect(result).toBe(partialWeek[0]) // Falls back to Wednesday
  })

  it('throws error for empty dates array', () => {
    expect(() => pickDay([], 'midweek')).toThrow('pickDay requires non-empty dates array')
  })
})

describe('computeRequiredSlots', () => {
  describe('with full week (Mon-Sun)', () => {
    const fullWeek = createWeek(MONDAY)

    it('returns fish midweek + legume weekend for omnivore', () => {
      const result = computeRequiredSlots('omnivore', fullWeek)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[2], // Wednesday
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: fullWeek[5], // Saturday
        proteinType: 'legume',
      })
    })

    it('returns fish early+late + legume midweek for pescatarian', () => {
      const result = computeRequiredSlots('pescatarian', fullWeek)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        date: fullWeek[1], // Tuesday
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // Friday
        proteinType: 'fish',
      })
      expect(result[2]).toEqual({
        date: fullWeek[2], // Wednesday
        proteinType: 'legume',
      })
    })

    it('returns legume early+late for vegetarian', () => {
      const result = computeRequiredSlots('vegetarian', fullWeek)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[1], // Tuesday
        proteinType: 'legume',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // Friday
        proteinType: 'legume',
      })
    })

    it('returns legume early+late for vegan', () => {
      const result = computeRequiredSlots('vegan', fullWeek)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[1], // Tuesday
        proteinType: 'legume',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // Friday
        proteinType: 'legume',
      })
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty dates', () => {
      const result = computeRequiredSlots('omnivore', [])
      expect(result).toEqual([])
    })

    it('handles partial week by falling back to first date', () => {
      // Wed-Sun only (no Mon, Tue) - 5 days, meets threshold
      const fullWeek = createWeek(MONDAY)
      const partialWeek = fullWeek.slice(2) // Wed, Thu, Fri, Sat, Sun

      const result = computeRequiredSlots('pescatarian', partialWeek)

      // 5 days meets the MIN_DAYS_FOR_BALANCE threshold (5)
      expect(result).toHaveLength(3)
      // Tuesday (early) not found, falls back to first date (Wed)
      expect(result[0]).toEqual({
        date: partialWeek[0], // Wednesday (fallback)
        proteinType: 'fish',
      })
      // Friday (late) found
      expect(result[1]).toEqual({
        date: partialWeek[2], // Friday
        proteinType: 'fish',
      })
      // Wednesday (midweek) found
      expect(result[2]).toEqual({
        date: partialWeek[0], // Wednesday
        proteinType: 'legume',
      })
    })

    it('handles week not starting on Monday', () => {
      // Start on Wednesday Jan 8, 2025
      const wednesday = new Date(2025, 0, 8)
      const midWeekStart = createWeek(wednesday) // Wed, Thu, Fri, Sat, Sun, Mon, Tue

      const result = computeRequiredSlots('omnivore', midWeekStart)

      expect(result).toHaveLength(2)
      // Wednesday is first day, which is midweek
      expect(result[0]!.date.getDay()).toBe(3) // Wednesday for fish
      expect(result[0]!.proteinType).toBe('fish')
      // Saturday is in range
      expect(result[1]!.date.getDay()).toBe(6) // Saturday for legume
      expect(result[1]!.proteinType).toBe('legume')
    })

    it('returns empty array for short weeks (less than 5 days)', () => {
      const singleDay = [new Date(2025, 0, 8)] // Wednesday

      const result = computeRequiredSlots('vegetarian', singleDay)

      // Short weeks (<5 days) have relaxed constraints - no required slots
      expect(result).toHaveLength(0)
    })

    it('returns slots for 5+ day weeks', () => {
      // Create a 5-day week (Wed-Sun)
      const fiveDays: Date[] = []
      for (let i = 0; i < 5; i++) {
        const date = new Date(2025, 0, 8 + i) // Wed Jan 8 through Sun Jan 12
        fiveDays.push(date)
      }

      const result = computeRequiredSlots('vegetarian', fiveDays)

      // 5+ days should still have balance constraints
      expect(result).toHaveLength(2)
    })
  })
})
