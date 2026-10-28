import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus, MealType } from '@/generated/prisma/enums'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import type { FridgeItemInput } from './fridge-items'

/**
 * How many days back a fridge meal may take leftovers from (HON-1277),
 * counted back from the fridge meal's own day.
 */
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

/**
 * Why a leftover item cannot point at its source, or null when every one can:
 *
 * - `notFound`: no entry of this household's plan
 * - `notRecipe`: a fridge meal, a placeholder or a note-only card
 * - `skipped`: the household will not cook it
 * - `notBefore`: not in an earlier slot than the fridge meal
 * - `tooOld`: more than `RECENT_MEALS_DAYS` before the fridge meal's day
 * - `servingsRequired`: still planned, and the item has no `servings`
 */
export type LeftoverSourceProblem =
  'notFound' | 'notRecipe' | 'skipped' | 'notBefore' | 'tooOld' | 'servingsRequired'

/** Slot order within a day, so the same-day breakfast comes before the lunch. */
const MEAL_TYPE_ORDER = Object.values(MealType)

/**
 * The source rule for a fridge meal planned at `target` (HON-1394): a leftover
 * item may point at a recipe meal, planned or completed, in an earlier slot no
 * more than `RECENT_MEALS_DAYS` before it. So tomorrow's lunch can point at
 * tonight's dinner before it is cooked. The window counts back from the lunch,
 * not from today, so it means the same for a lunch a week ahead.
 *
 * A planned source needs `servings`, because the dinner is bought for them
 * (`getCookServings`); a completed one may omit them. The MCP `plan_fridge_meal`
 * runs this. `toItemRows` does not, because Edit items and Undo send stored
 * items back, and the app's picker still offers cooked meals only
 * (`loadRecentMeals`).
 */
export async function findLeftoverSourceProblem(
  householdId: string,
  target: { date: string; mealType: MealType },
  items: readonly FridgeItemInput[],
): Promise<{ sourceEntryId: string; problem: LeftoverSourceProblem } | null> {
  const leftovers = items.flatMap((item) => ('sourceEntryId' in item ? [item] : []))
  if (leftovers.length === 0) return null

  const sources = await prisma.mealPlanEntry.findMany({
    where: { id: { in: leftovers.map((item) => item.sourceEntryId) }, plan: { householdId } },
    select: { id: true, date: true, mealType: true, status: true, kind: true, mealId: true },
  })
  const byId = new Map(sources.map((source) => [source.id, source]))
  const earliest = parseLocalDate(target.date)
  earliest.setDate(earliest.getDate() - RECENT_MEALS_DAYS)
  const earliestDate = toDateString(earliest)

  for (const item of leftovers) {
    const source = byId.get(item.sourceEntryId)
    const problem = sourceProblem(source, item.servings, target, earliestDate)
    if (problem) return { sourceEntryId: item.sourceEntryId, problem }
  }
  return null
}

function sourceProblem(
  source:
    | {
        date: Date
        mealType: MealType
        status: MealPlanEntryStatus
        kind: string
        mealId: string | null
      }
    | undefined,
  servings: number | undefined,
  target: { date: string; mealType: MealType },
  earliestDate: string,
): LeftoverSourceProblem | null {
  if (!source) return 'notFound'
  if (source.kind !== 'meal' || source.mealId === null) return 'notRecipe'
  if (source.status === MealPlanEntryStatus.skipped) return 'skipped'
  const date = toDateString(source.date)
  const isBefore =
    date < target.date ||
    (date === target.date &&
      MEAL_TYPE_ORDER.indexOf(source.mealType) < MEAL_TYPE_ORDER.indexOf(target.mealType))
  if (!isBefore) return 'notBefore'
  if (date < earliestDate) return 'tooOld'
  if (source.status === MealPlanEntryStatus.planned && servings === undefined) {
    return 'servingsRequired'
  }
  return null
}
