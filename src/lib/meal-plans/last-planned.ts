import 'server-only'
import { prisma } from '@/lib/prisma'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'

/**
 * The latest day before `before` (`YYYY-MM-DD`) on which the household planned
 * `mealId`, as `YYYY-MM-DD`, or null if it never did. Any status counts: a
 * skipped entry was planned too. `plan_meal` returns it so an assistant can
 * mention a repeat (HON-1306).
 */
export async function findLastPlannedDate(
  householdId: string,
  mealId: string,
  before: string,
): Promise<string | null> {
  const entry = await prisma.mealPlanEntry.findFirst({
    where: { plan: { householdId }, mealId, date: { lt: parseLocalDate(before) } },
    orderBy: { date: 'desc' },
    select: { date: true },
  })
  return entry ? toDateString(entry.date) : null
}
