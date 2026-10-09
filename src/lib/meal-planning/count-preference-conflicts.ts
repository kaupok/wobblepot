import 'server-only'
import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'
import {
  findPreferenceConflicts,
  type ConflictPreferences,
} from '@/lib/meal-planning/preference-conflicts'

/**
 * How many of the household's planned meals, from its today onward, break
 * `preferences` (HON-1126). The preferences save reports it in its toast; the
 * cards mark the same meals through `loadPlanEntries`. Reads only, so the save
 * never changes the plan by itself.
 */
export async function countConflictingPlannedEntries(
  household: { id: string; timezone: string },
  preferences: ConflictPreferences,
): Promise<number> {
  const today = parseLocalDate(getTodayInTimezone(household.timezone))
  const entries = await prisma.mealPlanEntry.findMany({
    where: {
      plan: { householdId: household.id },
      status: 'planned',
      date: { gte: today },
      mealId: { not: null },
    },
    select: {
      meal: {
        select: {
          name: true,
          components: {
            select: {
              ingredientId: true,
              ingredient: { select: { name: true, allergens: true } },
            },
          },
        },
      },
    },
  })
  return entries.filter(
    (entry) => entry.meal && findPreferenceConflicts(entry.meal, preferences).length > 0,
  ).length
}
