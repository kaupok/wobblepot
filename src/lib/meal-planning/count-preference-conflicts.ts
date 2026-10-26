import 'server-only'
import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'
import { getExcludedIngredientIds } from '@/lib/household/excluded-ingredients'
import {
  findPreferenceConflicts,
  type HouseholdFoodPreferences,
} from '@/lib/meal-planning/preference-conflicts'
import { applyEntryChanges } from '@/lib/meal-planning/entry-components'

/**
 * How many of the household's planned meals, from its today onward, break
 * `preferences` (HON-1126). The preferences save reports it in its toast; the
 * cards mark the same meals through `loadPlanEntries`. Reads only, so the save
 * never changes the plan by itself.
 */
export async function countConflictingPlannedEntries(
  household: { id: string; timezone: string },
  preferences: HouseholdFoodPreferences,
): Promise<number> {
  const excludedIngredientIds = await getExcludedIngredientIds(
    household.id,
    preferences.excludedIngredients,
  )
  const today = parseLocalDate(getTodayInTimezone(household.timezone))
  const ingredient = { name: true, allergens: true } as const
  const entries = await prisma.mealPlanEntry.findMany({
    where: {
      plan: { householdId: household.id },
      status: 'planned',
      date: { gte: today },
      mealId: { not: null },
    },
    select: {
      // The entry's own ingredient changes (HON-1243): the cards judge the
      // merged list (`loadPlanEntries`), so the count does too.
      changes: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          originalIngredientId: true,
          replacementIngredientId: true,
          quantityPerServing: true,
          replacementIngredient: { select: ingredient },
        },
      },
      meal: {
        select: {
          name: true,
          components: {
            select: {
              ingredientId: true,
              quantityPerServing: true,
              ingredient: { select: ingredient },
            },
          },
        },
      },
    },
  })
  return entries.filter(
    (entry) =>
      entry.meal &&
      findPreferenceConflicts(
        { ...entry.meal, components: applyEntryChanges(entry.meal.components, entry.changes) },
        { ...preferences, excludedIngredientIds },
      ).length > 0,
  ).length
}
