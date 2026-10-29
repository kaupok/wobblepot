import 'server-only'

import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

/** The days `/past-meals` opens on, and each "Show the week before" adds. */
export const PAST_MEALS_DAYS = 7

interface PastMealsRangeOptions {
  /** How many weeks back the page reaches: 1, plus one per "Show the week before". */
  weeks?: number
  /**
   * When the household was created. "Show the week before" stops at the week
   * that holds that day, so the page never reaches a week before the
   * household existed (HON-1383). The first week always shows.
   */
  createdAt?: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The past-meals window in the household's day: `[today − 7·weeks, today)`,
 * so "yesterday" is theirs and not the server's. `/past-meals` lists this
 * range and the header's dot counts its first week, so the two cannot
 * disagree (HON-1028). `weeks` is clamped to the week that holds the
 * household's first day, and `hasEarlierWeek` is false once it is reached.
 */
export function getPastMealsRange(timezone: string, options: PastMealsRangeOptions = {}) {
  const todayDate = getTodayInTimezone(timezone)
  const endDate = parseLocalDate(todayDate)
  // The count comes off the URL, so a typed `?weeks=abc` or `0` is one week.
  const requested = Math.floor(options.weeks ?? 1)
  let weeks = Number.isFinite(requested) && requested >= 1 ? requested : 1
  let hasEarlierWeek = true
  if (options.createdAt) {
    const firstDay = parseLocalDate(getTodayInTimezone(timezone, options.createdAt))
    // Rounded, because a DST change makes a local day 23 or 25 hours long.
    const daysBack = Math.round((endDate.getTime() - firstDay.getTime()) / DAY_MS)
    const maxWeeks = Math.max(1, Math.ceil(daysBack / PAST_MEALS_DAYS))
    weeks = Math.min(weeks, maxWeeks)
    hasEarlierWeek = weeks < maxWeeks
  }
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - PAST_MEALS_DAYS * weeks)
  return { todayDate, startDate, endDate, weeks, hasEarlierWeek }
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
