import { describe, it, expect } from 'vitest'
import {
  computeRequiredSlots,
  computeMealSlots,
  pickDay,
  shouldEnforceBalanceConstraints,
} from './slots'
import type { MealType } from '@/generated/prisma/enums'

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

// Default meal type preferences
const DEFAULT_WEEKDAY_MEALS: MealType[] = ['dinner']
const DEFAULT_WEEKEND_MEALS: MealType[] = ['dinner']

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

describe('computeMealSlots', () => {
  const fullWeek = createWeek(MONDAY)

  it('expands dates with default dinner-only config', () => {
    const result = computeMealSlots(fullWeek, DEFAULT_WEEKDAY_MEALS, DEFAULT_WEEKEND_MEALS)

    // 7 days × 1 meal type = 7 slots
    expect(result).toHaveLength(7)
    expect(result.every((s) => s.mealType === 'dinner')).toBe(true)
  })

  it('expands weekdays with multiple meal types', () => {
    const weekdayMeals: MealType[] = ['lunch', 'dinner']
    const weekendMeals: MealType[] = ['dinner']

    const result = computeMealSlots(fullWeek, weekdayMeals, weekendMeals)

    // 5 weekdays × 2 meals + 2 weekends × 1 meal = 12 slots
    expect(result).toHaveLength(12)

    // Check weekday entries have both lunch and dinner
    const monday = fullWeek[0]!
    const mondaySlots = result.filter((s) => s.date.getTime() === monday.getTime())
    expect(mondaySlots).toHaveLength(2)
    expect(mondaySlots.map((s) => s.mealType).sort()).toEqual(['dinner', 'lunch'])

    // Check weekend entries only have dinner
    const saturday = fullWeek[5]!
    const saturdaySlots = result.filter((s) => s.date.getTime() === saturday.getTime())
    expect(saturdaySlots).toHaveLength(1)
    expect(saturdaySlots[0]!.mealType).toBe('dinner')
  })

  it('expands weekends with multiple meal types', () => {
    const weekdayMeals: MealType[] = ['dinner']
    const weekendMeals: MealType[] = ['breakfast', 'lunch', 'dinner']

    const result = computeMealSlots(fullWeek, weekdayMeals, weekendMeals)

    // 5 weekdays × 1 meal + 2 weekends × 3 meals = 11 slots
    expect(result).toHaveLength(11)

    // Check weekend entries have all three meals
    const sunday = fullWeek[6]!
    const sundaySlots = result.filter((s) => s.date.getTime() === sunday.getTime())
    expect(sundaySlots).toHaveLength(3)
    expect(sundaySlots.map((s) => s.mealType).sort()).toEqual(['breakfast', 'dinner', 'lunch'])
  })

  it('handles empty dates array', () => {
    const result = computeMealSlots([], ['lunch', 'dinner'], ['dinner'])
    expect(result).toEqual([])
  })

  it('handles partial week', () => {
    // Wed-Sun (5 days: Wed=weekday, Thu=weekday, Fri=weekday, Sat=weekend, Sun=weekend)
    const partialWeek = fullWeek.slice(2)
    const weekdayMeals: MealType[] = ['lunch', 'dinner']
    const weekendMeals: MealType[] = ['dinner']

    const result = computeMealSlots(partialWeek, weekdayMeals, weekendMeals)

    // 3 weekdays × 2 meals + 2 weekends × 1 meal = 8 slots
    expect(result).toHaveLength(8)
  })
})

describe('computeRequiredSlots', () => {
  describe('with full week (Mon-Sun)', () => {
    const fullWeek = createWeek(MONDAY)

    it('returns fish midweek + legume weekend for no preference with dinner', () => {
      const result = computeRequiredSlots({
        dietaryType: null,
        dates: fullWeek,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[2], // Wednesday
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: fullWeek[5], // Saturday
        mealType: 'dinner',
        proteinType: 'legume',
      })
    })

    it('returns fish early+late + legume midweek for pescatarian', () => {
      const result = computeRequiredSlots({
        dietaryType: 'pescatarian',
        dates: fullWeek,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        date: fullWeek[1], // Tuesday
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // Friday
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[2]).toEqual({
        date: fullWeek[2], // Wednesday
        mealType: 'dinner',
        proteinType: 'legume',
      })
    })

    it('returns legume early+late for vegetarian', () => {
      const result = computeRequiredSlots({
        dietaryType: 'vegetarian',
        dates: fullWeek,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[1], // Tuesday
        mealType: 'dinner',
        proteinType: 'legume',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // Friday
        mealType: 'dinner',
        proteinType: 'legume',
      })
    })

    it('returns legume early+late for vegan', () => {
      const result = computeRequiredSlots({
        dietaryType: 'vegan',
        dates: fullWeek,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[1], // Tuesday
        mealType: 'dinner',
        proteinType: 'legume',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // Friday
        mealType: 'dinner',
        proteinType: 'legume',
      })
    })
  })

  describe('balance constraints only apply to dinner', () => {
    const fullWeek = createWeek(MONDAY)

    it('returns slots only when dinner is in preferences', () => {
      // No dinner in preferences - no balance constraints
      const result = computeRequiredSlots({
        dietaryType: null,
        dates: fullWeek,
        weekdayMealTypes: ['lunch'],
        weekendMealTypes: ['breakfast', 'lunch'],
      })

      expect(result).toHaveLength(0)
    })

    it('applies constraints when dinner is only on weekdays', () => {
      const result = computeRequiredSlots({
        dietaryType: null,
        dates: fullWeek,
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['breakfast'], // No dinner on weekends
      })

      // Only 5 dinner days (weekdays), so:
      // - Fish midweek (Wednesday) - dinner exists
      // - Legume weekend (Saturday) - NO dinner on Saturday!
      // Since weekend has no dinner, the legume slot can't be on Saturday
      // The fallback should still work within dinner dates
      expect(result).toHaveLength(2)
      expect(result[0]!.mealType).toBe('dinner')
      expect(result[1]!.mealType).toBe('dinner')
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty dates', () => {
      const result = computeRequiredSlots({
        dietaryType: null,
        dates: [],
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })
      expect(result).toEqual([])
    })

    it('handles partial week by falling back to first date', () => {
      // Wed-Sun only (no Mon, Tue) - 5 days
      const fullWeek = createWeek(MONDAY)
      const partialWeek = fullWeek.slice(2) // Wed, Thu, Fri, Sat, Sun

      const result = computeRequiredSlots({
        dietaryType: 'pescatarian',
        dates: partialWeek,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      // 5 dinner days meets the MIN_DAYS_FOR_BALANCE threshold (5)
      expect(result).toHaveLength(3)
      // Tuesday (early) not found, falls back to first date (Wed)
      expect(result[0]).toEqual({
        date: partialWeek[0], // Wednesday (fallback)
        mealType: 'dinner',
        proteinType: 'fish',
      })
      // Friday (late) found
      expect(result[1]).toEqual({
        date: partialWeek[2], // Friday
        mealType: 'dinner',
        proteinType: 'fish',
      })
      // Wednesday (midweek) found
      expect(result[2]).toEqual({
        date: partialWeek[0], // Wednesday
        mealType: 'dinner',
        proteinType: 'legume',
      })
    })

    it('handles week not starting on Monday', () => {
      // Start on Wednesday Jan 8, 2025
      const wednesday = new Date(2025, 0, 8)
      const midWeekStart = createWeek(wednesday) // Wed, Thu, Fri, Sat, Sun, Mon, Tue

      const result = computeRequiredSlots({
        dietaryType: null,
        dates: midWeekStart,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      expect(result).toHaveLength(2)
      // Wednesday is first day, which is midweek
      expect(result[0]!.date.getDay()).toBe(3) // Wednesday for fish
      expect(result[0]!.proteinType).toBe('fish')
      expect(result[0]!.mealType).toBe('dinner')
      // Saturday is in range
      expect(result[1]!.date.getDay()).toBe(6) // Saturday for legume
      expect(result[1]!.proteinType).toBe('legume')
      expect(result[1]!.mealType).toBe('dinner')
    })

    it('returns empty array for short weeks (less than 5 dinner days)', () => {
      const singleDay = [new Date(2025, 0, 8)] // Wednesday

      const result = computeRequiredSlots({
        dietaryType: 'vegetarian',
        dates: singleDay,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      // Short weeks (<5 dinner days) have relaxed constraints - no required slots
      expect(result).toHaveLength(0)
    })

    it('returns slots for 5+ dinner day weeks', () => {
      // Create a 5-day week (Wed-Sun)
      const fiveDays: Date[] = []
      for (let i = 0; i < 5; i++) {
        const date = new Date(2025, 0, 8 + i) // Wed Jan 8 through Sun Jan 12
        fiveDays.push(date)
      }

      const result = computeRequiredSlots({
        dietaryType: 'vegetarian',
        dates: fiveDays,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      // 5+ dinner days should still have balance constraints
      expect(result).toHaveLength(2)
    })
  })
})
