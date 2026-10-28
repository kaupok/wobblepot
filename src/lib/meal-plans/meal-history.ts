import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'

/** The window `cookedLast28Days` counts: today and the 27 days before it. */
export const COOKED_WINDOW_DAYS = 28

/** When a household last cooked a meal and when it plans it next (HON-1388). */
export interface MealHistory {
  /** The latest completed entry on or before today, `YYYY-MM-DD`. */
  lastCookedOn: string | null
  /** Completed entries in `[today − 27, today]`. */
  cookedLast28Days: number
  /** The earliest planned entry from today on, `YYYY-MM-DD`. */
  nextPlannedOn: string | null
}

export const NO_HISTORY: MealHistory = {
  lastCookedOn: null,
  cookedLast28Days: 0,
  nextPlannedOn: null,
}

/**
 * The history of each of `mealIds` in the household's plan, as of `today`
 * (`YYYY-MM-DD` in the household's timezone). Only a completed entry counts as
 * cooked: a skipped entry was not eaten, and a past entry still `planned` was
 * never marked. A meal with no entries is missing from the map.
 */
export async function loadMealHistory(
  householdId: string,
  mealIds: string[],
  today: string,
): Promise<Map<string, MealHistory>> {
  const history = new Map<string, MealHistory>()
  if (mealIds.length === 0) return history

  const todayDate = parseLocalDate(today)
  const tomorrow = new Date(todayDate)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const windowStart = new Date(todayDate)
  windowStart.setDate(windowStart.getDate() - (COOKED_WINDOW_DAYS - 1))

  const scope = { plan: { householdId }, mealId: { in: mealIds } }
  const completed = { ...scope, status: MealPlanEntryStatus.completed }
  const [lastCooked, recentCounts, nextPlanned] = await Promise.all([
    prisma.mealPlanEntry.groupBy({
      by: ['mealId'],
      where: { ...completed, date: { lt: tomorrow } },
      _max: { date: true },
    }),
    prisma.mealPlanEntry.groupBy({
      by: ['mealId'],
      where: { ...completed, date: { gte: windowStart, lt: tomorrow } },
      _count: { _all: true },
    }),
    prisma.mealPlanEntry.groupBy({
      by: ['mealId'],
      where: { ...scope, status: MealPlanEntryStatus.planned, date: { gte: todayDate } },
      _min: { date: true },
    }),
  ])

  const entry = (mealId: string) => {
    const existing = history.get(mealId) ?? { ...NO_HISTORY }
    history.set(mealId, existing)
    return existing
  }
  for (const row of lastCooked) {
    if (row.mealId && row._max.date) entry(row.mealId).lastCookedOn = toDateString(row._max.date)
  }
  for (const row of recentCounts) {
    if (row.mealId) entry(row.mealId).cookedLast28Days = row._count._all
  }
  for (const row of nextPlanned) {
    if (row.mealId && row._min.date) entry(row.mealId).nextPlannedOn = toDateString(row._min.date)
  }
  return history
}

/**
 * The `longestSinceCooked` order: the meal the household has gone longest
 * without first. A meal never cooked comes after every cooked one, and a meal
 * already planned comes last, because neither is a gap to fill.
 */
export function compareLongestSinceCooked(a: MealHistory, b: MealHistory): number {
  const rank = (h: MealHistory) => (h.nextPlannedOn ? 2 : h.lastCookedOn ? 0 : 1)
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank
  // `YYYY-MM-DD` sorts as a date; older first.
  return (a.lastCookedOn ?? '').localeCompare(b.lastCookedOn ?? '')
}
