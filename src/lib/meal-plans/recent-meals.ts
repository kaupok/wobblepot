import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'

/** How many days back a fridge meal may take leftovers from (HON-1277). */
export const RECENT_MEALS_DAYS = 3

/** A recently completed meal the fridge-meal picker offers as leftovers. */
export interface RecentMeal {
  entryId: string
  mealName: string
  /** The entry's day, `YYYY-MM-DD`. */
  date: string
}

/**
 * The recipe meals the household completed in `[today − 3, today]` of its own
 * day, newest first: the leftovers a fridge meal can use. A fridge meal is not
 * one, because it has no name to show, and a planned or skipped entry was not
 * eaten.
 */
export async function loadRecentMeals(
  household: { id: string; timezone: string; locale: string | null },
  now: Date = new Date(),
): Promise<RecentMeal[]> {
  const today = parseLocalDate(getTodayInTimezone(household.timezone, now))
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - RECENT_MEALS_DAYS)
  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() + 1)

  const entries = await prisma.mealPlanEntry.findMany({
    where: {
      plan: { householdId: household.id },
      date: { gte: startDate, lt: endDate },
      status: MealPlanEntryStatus.completed,
      kind: 'meal',
      mealId: { not: null },
    },
    orderBy: [{ date: 'desc' }, { mealType: 'desc' }],
    select: {
      id: true,
      date: true,
      meal: { select: { name: true, ...mealTranslationsInclude(household.locale) } },
    },
  })

  return entries.flatMap((entry) =>
    entry.meal
      ? [
          {
            entryId: entry.id,
            mealName: translateMeal(entry.meal, household.locale).name,
            date: toDateString(entry.date),
          },
        ]
      : [],
  )
}
