import 'server-only'
import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'

/** The days `/past-meals` opens on, and each "Show the week before" adds. */
export const PAST_MEALS_DAYS = 7

interface PastMealsRangeOptions {
  /** How many weeks back the page reaches: 1, plus one per "Show the week before". */
  weeks?: number
  /**
   * When the household was created. The range never starts before that day,
   * so a household sees no empty slots from before it existed (HON-1383).
   */
  createdAt?: Date
}

/**
 * The past-meals window in the household's day: `[today − 7·weeks, today)`,
 * so "yesterday" is theirs and not the server's. `/past-meals` lists this
 * range and the header's dot counts its first week, so the two cannot
 * disagree (HON-1028). `hasEarlierWeek` is false once the range reaches the
 * household's first day: there is nothing before it to show.
 */
export function getPastMealsRange(timezone: string, options: PastMealsRangeOptions = {}) {
  const todayDate = getTodayInTimezone(timezone)
  const endDate = parseLocalDate(todayDate)
  // The count comes off the URL, so a typed `?weeks=abc` or `0` is one week.
  const requested = Math.floor(options.weeks ?? 1)
  const weeks = Number.isFinite(requested) && requested >= 1 ? requested : 1
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - PAST_MEALS_DAYS * weeks)
  if (!options.createdAt) {
    return { todayDate, startDate, endDate, weeks, hasEarlierWeek: true }
  }
  const firstDay = parseLocalDate(getTodayInTimezone(timezone, options.createdAt))
  const hasEarlierWeek = startDate > firstDay
  return {
    todayDate,
    startDate: hasEarlierWeek ? startDate : firstDay,
    endDate,
    weeks,
    hasEarlierWeek,
  }
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
