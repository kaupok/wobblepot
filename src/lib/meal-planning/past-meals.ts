import 'server-only'
import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'

/** How far back past meals reach. An archive beyond this is out of scope. */
export const PAST_MEALS_DAYS = 7

/**
 * The past-meals window in the household's day: `[today − 7, today)`, so
 * "yesterday" is theirs and not the server's. `/past-meals` lists this range
 * and the header's dot counts it, so the two cannot disagree (HON-1028).
 */
export function getPastMealsRange(timezone: string) {
  const todayDate = getTodayInTimezone(timezone)
  const endDate = parseLocalDate(todayDate)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - PAST_MEALS_DAYS)
  return { todayDate, startDate, endDate }
}

/**
 * Past meals the household has not marked yet: in the past-meals window,
 * still `planned`, and with a meal (a slot with only a note has nothing to
 * mark). Marking one cooked runs the pantry deduction and the rating prompt,
 * so this is the count the account menu's dot asks the household to clear.
 *
 * One `count`, not an entry load: the header runs it on every page.
 */
export async function countPastMealsToMark(household: {
  id: string
  timezone: string
}): Promise<number> {
  const { startDate, endDate } = getPastMealsRange(household.timezone)
  return prisma.mealPlanEntry.count({
    where: {
      plan: { householdId: household.id },
      date: { gte: startDate, lt: endDate },
      status: 'planned',
      mealId: { not: null },
    },
  })
}
