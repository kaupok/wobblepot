import { ProteinType, IngredientCategory } from '@/generated/prisma/enums'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'

// The candidates, slots and options `fill-plan.test.ts` builds its runs from.

export function date(dateStr: string): Date {
  return parseLocalDate(dateStr)
}

export function createCandidate(overrides: Partial<CandidateMeal> = {}): CandidateMeal {
  return {
    id: overrides.id ?? 'meal-1',
    name: overrides.name ?? 'Test Meal',
    kidFriendly: overrides.kidFriendly ?? false,
    primaryProteinType: overrides.primaryProteinType ?? ProteinType.poultry,
    topIngredients: overrides.topIngredients ?? [
      { name: 'Chicken', category: IngredientCategory.protein },
    ],
    isFavorite: overrides.isFavorite ?? false,
    isCustom: overrides.isCustom ?? false,
  }
}

export function createMockMeals(count: number, startIndex = 1): CandidateMeal[] {
  return Array.from({ length: count }, (_, i) =>
    createCandidate({
      id: `meal-${startIndex + i}`,
      name: `Meal ${startIndex + i}`,
      kidFriendly: i % 2 === 0, // Alternate kid-friendly
    }),
  )
}

// Helper to create default meal slots for a week (Mon-Sun, dinner only)
export function createDefaultMealSlots() {
  return [
    { date: date('2026-01-12'), mealType: 'dinner' as const },
    { date: date('2026-01-13'), mealType: 'dinner' as const },
    { date: date('2026-01-14'), mealType: 'dinner' as const },
    { date: date('2026-01-15'), mealType: 'dinner' as const },
    { date: date('2026-01-16'), mealType: 'dinner' as const },
    { date: date('2026-01-17'), mealType: 'dinner' as const },
    { date: date('2026-01-18'), mealType: 'dinner' as const },
  ]
}

/** A week of dinners, Monday 12 to Sunday 18 January 2026. */
export const fillOptions = {
  planId: 'plan-1',
  householdId: 'household-1',
  startDate: date('2026-01-12'),
  endDate: date('2026-01-19'),
  dietaryType: null,
  allergensToAvoid: [],
  excludedIngredientIds: [],
  restrictions: [],
  locale: 'en',
  weekdayMealTypes: ['dinner' as const],
  weekendMealTypes: ['dinner' as const],
}
