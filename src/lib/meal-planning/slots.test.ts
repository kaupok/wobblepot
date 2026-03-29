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
  describe('with 7-element array', () => {
    const fullWeek = createWeek(MONDAY)

    it('picks index 1 for early (round(0.15 * 6) = 1)', () => {
      const result = pickDay(fullWeek, 'early')
      expect(result).toBe(fullWeek[1]) // index 1
    })

    it('picks index 2 for midweek (round(0.4 * 6) = 2)', () => {
      const result = pickDay(fullWeek, 'midweek')
      expect(result).toBe(fullWeek[2]) // index 2
    })

    it('picks index 4 for late (round(0.7 * 6) = 4)', () => {
      const result = pickDay(fullWeek, 'late')
      expect(result).toBe(fullWeek[4]) // index 4
    })

    it('picks index 5 for weekend (round(0.8 * 6) = 5)', () => {
      const result = pickDay(fullWeek, 'weekend')
      expect(result).toBe(fullWeek[5]) // index 5
    })
  })

  describe('with 5-element array', () => {
    const fullWeek = createWeek(MONDAY)
    const fiveDays = fullWeek.slice(0, 5)

    it('picks index 1 for early (round(0.15 * 4) = 1)', () => {
      const result = pickDay(fiveDays, 'early')
      expect(result).toBe(fiveDays[1])
    })

    it('picks index 2 for midweek (round(0.4 * 4) = 2)', () => {
      const result = pickDay(fiveDays, 'midweek')
      expect(result).toBe(fiveDays[2])
    })

    it('picks index 3 for late (round(0.7 * 4) = 3)', () => {
      const result = pickDay(fiveDays, 'late')
      expect(result).toBe(fiveDays[3])
    })

    it('picks index 3 for weekend (round(0.8 * 4) = 3)', () => {
      const result = pickDay(fiveDays, 'weekend')
      expect(result).toBe(fiveDays[3])
    })
  })

  describe('with 1-element array', () => {
    const singleDay = [new Date(2025, 0, 8)]

    it('picks index 0 for all slot types', () => {
      expect(pickDay(singleDay, 'early')).toBe(singleDay[0])
      expect(pickDay(singleDay, 'midweek')).toBe(singleDay[0])
      expect(pickDay(singleDay, 'late')).toBe(singleDay[0])
      expect(pickDay(singleDay, 'weekend')).toBe(singleDay[0])
    })
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

      // 7 dinner dates → midweek=index 2 (Wed), weekend=index 5 (Sat)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[2], // index 2 (Wednesday)
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: fullWeek[5], // index 5 (Saturday)
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

      // 7 dinner dates → early=index 1 (Tue), late=index 4 (Fri), midweek=index 2 (Wed)
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        date: fullWeek[1], // index 1 (Tuesday)
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // index 4 (Friday)
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[2]).toEqual({
        date: fullWeek[2], // index 2 (Wednesday)
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

      // 7 dinner dates → early=index 1 (Tue), late=index 4 (Fri)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[1], // index 1 (Tuesday)
        mealType: 'dinner',
        proteinType: 'legume',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // index 4 (Friday)
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

      // 7 dinner dates → early=index 1 (Tue), late=index 4 (Fri)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[1], // index 1 (Tuesday)
        mealType: 'dinner',
        proteinType: 'legume',
      })
      expect(result[1]).toEqual({
        date: fullWeek[4], // index 4 (Friday)
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

      // 5 dinner dates (Mon-Fri, indices 0-4):
      // midweek=round(0.4*4)=2 → Wed, weekend=round(0.8*4)=3 → Thu
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fullWeek[2], // Wednesday (dinnerDates index 2)
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: fullWeek[3], // Thursday (dinnerDates index 3)
        mealType: 'dinner',
        proteinType: 'legume',
      })
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

    it('handles partial week with relative positioning', () => {
      // Wed-Sun only (no Mon, Tue) - 5 days
      const fullWeek = createWeek(MONDAY)
      const partialWeek = fullWeek.slice(2) // Wed, Thu, Fri, Sat, Sun

      const result = computeRequiredSlots({
        dietaryType: 'pescatarian',
        dates: partialWeek,
        weekdayMealTypes: DEFAULT_WEEKDAY_MEALS,
        weekendMealTypes: DEFAULT_WEEKEND_MEALS,
      })

      // 5 dinner dates (indices 0-4):
      // early=round(0.15*4)=1 → Thu, late=round(0.7*4)=3 → Sat, midweek=round(0.4*4)=2 → Fri
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        date: partialWeek[1], // Thursday (index 1)
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: partialWeek[3], // Saturday (index 3)
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[2]).toEqual({
        date: partialWeek[2], // Friday (index 2)
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

      // 7 dinner dates (indices 0-6):
      // midweek=index 2 (Fri), weekend=index 5 (Mon)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: midWeekStart[2], // Friday (index 2)
        mealType: 'dinner',
        proteinType: 'fish',
      })
      expect(result[1]).toEqual({
        date: midWeekStart[5], // Monday (index 5)
        mealType: 'dinner',
        proteinType: 'legume',
      })
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

      // 5 dinner dates (indices 0-4):
      // early=round(0.15*4)=1 → Thu, late=round(0.7*4)=3 → Sat
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        date: fiveDays[1], // Thursday (index 1)
        mealType: 'dinner',
        proteinType: 'legume',
      })
      expect(result[1]).toEqual({
        date: fiveDays[3], // Saturday (index 3)
        mealType: 'dinner',
        proteinType: 'legume',
      })
    })
  })
})
