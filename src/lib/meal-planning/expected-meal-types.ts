import type { ExpectedMealTypes } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

/**
 * The meal types a household plans on a weekday and on a weekend day. They
 * come off the membership row, which already eager-loads `preferences`, so
 * no request to /api/households/me/preferences (HON-676). A household with no
 * `household_preferences` row, or an empty list, keeps dinner only (HON-672).
 * Today and Past meals both read through this, so their empty slots agree.
 */
export function getExpectedMealTypes(
  preferences: { weekdayMealTypes: MealType[]; weekendMealTypes: MealType[] } | null | undefined,
): ExpectedMealTypes {
  return {
    weekdayMealTypes: preferences?.weekdayMealTypes.length
      ? preferences.weekdayMealTypes
      : ['dinner'],
    weekendMealTypes: preferences?.weekendMealTypes.length
      ? preferences.weekendMealTypes
      : ['dinner'],
  }
}
