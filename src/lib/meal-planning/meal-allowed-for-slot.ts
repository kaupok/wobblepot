import 'server-only'

import type { MealType } from '@/generated/prisma/enums'
import { getExcludedIngredientIds } from '@/lib/household/excluded-ingredients'
import { getCandidates } from '@/lib/meal-planning/candidates'
import type { SlotSuggestionHousehold } from '@/lib/meal-planning/slot-suggestions'
import { visibleMealWhere } from '@/lib/meals/load-meals'
import { prisma } from '@/lib/prisma'

/**
 * Whether one chosen meal may go in a slot of `mealType`:
 *
 * - `notFound`: deleted, unknown, or another household's.
 * - `unsuitable`: its `suitableFor` does not include `mealType`.
 * - `ruledOut`: the household's diet, allergens or avoided ingredients rule it out.
 */
export type MealSlotFit = 'allowed' | 'notFound' | 'unsuitable' | 'ruledOut'

/**
 * The hard filters of the slot suggestions (`getCandidates`), for one meal and
 * without the no-repeat window: a meal the user chose may repeat (HON-1306).
 */
export async function isMealAllowedForSlot(
  household: SlotSuggestionHousehold,
  mealId: string,
  mealType: MealType,
): Promise<MealSlotFit> {
  const meal = await prisma.meal.findFirst({
    where: { id: mealId, ...visibleMealWhere(household.id) },
    select: { suitableFor: true },
  })
  if (!meal) return 'notFound'
  if (!meal.suitableFor.includes(mealType)) return 'unsuitable'

  const preferences = household.preferences
  const pool = await getCandidates({
    mealType,
    allergensToAvoid: preferences?.allergensToAvoid ?? [],
    excludedIngredientIds: await getExcludedIngredientIds(
      household.id,
      preferences?.excludedIngredients ?? [],
    ),
    recentMealIds: [],
    dietaryType: preferences?.dietaryType ?? null,
    householdId: household.id,
    mealId,
  })
  return pool.length > 0 ? 'allowed' : 'ruledOut'
}

/**
 * Whether the household can see the meal: shared or its own, and not deleted.
 * A past day logs what the household ate, so it checks only this, as the app's
 * `createEntry` does (HON-1443).
 */
export async function isMealVisible(householdId: string, mealId: string): Promise<boolean> {
  const meal = await prisma.meal.findFirst({
    where: { id: mealId, ...visibleMealWhere(householdId) },
    select: { id: true },
  })
  return meal !== null
}
