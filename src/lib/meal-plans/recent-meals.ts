import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus, MealType } from '@/generated/prisma/enums'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import type { FridgeItemInput } from './fridge-items'

/**
 * How many days back a fridge meal may take leftovers from (HON-1277),
 * counted back from the fridge meal's own day.
 */
export const RECENT_MEALS_DAYS = 3

/** A meal the fridge-meal picker offers as leftovers for one slot. */
export interface LeftoverSource {
  entryId: string
  mealName: string
  /** The entry's day, `YYYY-MM-DD`. */
  date: string
  mealType: MealType
  /** `planned` is still to cook, such as tonight's dinner for tomorrow's lunch. */
  sourceState: 'planned' | 'completed'
}

/**
 * The recipe meals a fridge meal at `target` can take leftovers from, newest
 * first: the ones the source rule (`findLeftoverSourceProblem`) allows, so the
 * picker never offers a source the save refuses (HON-1396). A fridge meal is
 * not one, because it has no name to show, and a skipped entry is not cooked.
 */
export async function loadLeftoverSources(
  household: { id: string; locale: string | null },
  target: { date: string; mealType: MealType },
): Promise<LeftoverSource[]> {
  const earliestDate = earliestSourceDate(target.date)
  const endDate = parseLocalDate(target.date)
  endDate.setDate(endDate.getDate() + 1)

  const entries = await prisma.mealPlanEntry.findMany({
    where: {
      plan: { householdId: household.id },
      date: { gte: parseLocalDate(earliestDate), lt: endDate },
      status: { in: [MealPlanEntryStatus.planned, MealPlanEntryStatus.completed] },
      kind: 'meal',
      mealId: { not: null },
    },
    orderBy: [{ date: 'desc' }, { mealType: 'desc' }],
    select: {
      id: true,
      date: true,
      mealType: true,
      status: true,
      kind: true,
      mealId: true,
      meal: { select: { name: true, ...mealTranslationsInclude(household.locale) } },
    },
  })

  return entries.flatMap((entry) =>
    entry.meal && slotProblem(entry, target, earliestDate) === null
      ? [
          {
            entryId: entry.id,
            mealName: translateMeal(entry.meal, household.locale).name,
            date: toDateString(entry.date),
            mealType: entry.mealType,
            sourceState:
              entry.status === MealPlanEntryStatus.planned
                ? ('planned' as const)
                : ('completed' as const),
          },
        ]
      : [],
  )
}

/** The first day a source may be on: `RECENT_MEALS_DAYS` before the fridge meal's day. */
function earliestSourceDate(targetDate: string): string {
  const earliest = parseLocalDate(targetDate)
  earliest.setDate(earliest.getDate() - RECENT_MEALS_DAYS)
  return toDateString(earliest)
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

/**
 * The problems a change after the link can cause: a dinner skipped, made a
 * fridge meal, or set back from cooked to planned, or a window rule that moved
 * past a lunch saved under the old one. Undo after Clear sends the lunch's own
 * items back, which the window was checked against when first saved, so it
 * passes these (HON-1396, HON-1451).
 */
export const CHANGED_SOURCE_PROBLEMS: ReadonlySet<LeftoverSourceProblem> = new Set([
  'skipped',
  'notRecipe',
  'servingsRequired',
  'tooOld',
])

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
 * and the app's entry routes run this, and the picker lists what it allows
 * (`loadLeftoverSources`).
 *
 * For the same reason, an item `target.entryId` already stores, with the same
 * source and servings, passes unchanged. Its source can have changed since it
 * was linked: a dinner made a fridge meal or skipped keeps its lunches, so an
 * assistant that sends the lunch's items back to add one must not be refused.
 */
export async function findLeftoverSourceProblem(
  householdId: string,
  target: { date: string; mealType: MealType; entryId?: string },
  items: readonly FridgeItemInput[],
  /** Problems to pass, such as `CHANGED_SOURCE_PROBLEMS` for a restore. */
  tolerate: ReadonlySet<LeftoverSourceProblem> = new Set(),
): Promise<{ sourceEntryId: string; problem: LeftoverSourceProblem } | null> {
  const stored = target.entryId
    ? await prisma.mealPlanEntryItem.findMany({
        where: { entryId: target.entryId, sourceEntryId: { not: null } },
        select: { sourceEntryId: true, servings: true },
      })
    : []
  const isStored = (item: { sourceEntryId: string; servings?: number }) =>
    stored.some(
      (row) => row.sourceEntryId === item.sourceEntryId && row.servings === (item.servings ?? null),
    )
  const leftovers = items.flatMap((item) =>
    'sourceEntryId' in item && !isStored(item) ? [item] : [],
  )
  if (leftovers.length === 0) return null

  const sources = await prisma.mealPlanEntry.findMany({
    where: { id: { in: leftovers.map((item) => item.sourceEntryId) }, plan: { householdId } },
    select: { id: true, date: true, mealType: true, status: true, kind: true, mealId: true },
  })
  const byId = new Map(sources.map((source) => [source.id, source]))
  const earliestDate = earliestSourceDate(target.date)

  for (const item of leftovers) {
    const source = byId.get(item.sourceEntryId)
    const problem = sourceProblem(source, item.servings, target, earliestDate)
    if (problem && !tolerate.has(problem)) return { sourceEntryId: item.sourceEntryId, problem }
  }
  return null
}

interface SourceRow {
  date: Date
  mealType: MealType
  status: MealPlanEntryStatus
  kind: string
  mealId: string | null
}

function sourceProblem(
  source: SourceRow | undefined,
  servings: number | undefined,
  target: { date: string; mealType: MealType },
  earliestDate: string,
): LeftoverSourceProblem | null {
  if (!source) return 'notFound'
  const problem = slotProblem(source, target, earliestDate)
  if (problem) return problem
  if (source.status === MealPlanEntryStatus.planned && servings === undefined) {
    return 'servingsRequired'
  }
  return null
}

/** The part of the rule that the source alone decides, which the picker's list shares. */
function slotProblem(
  source: SourceRow,
  target: { date: string; mealType: MealType },
  earliestDate: string,
): Exclude<LeftoverSourceProblem, 'notFound' | 'servingsRequired'> | null {
  if (source.kind !== 'meal' || source.mealId === null) return 'notRecipe'
  if (source.status === MealPlanEntryStatus.skipped) return 'skipped'
  const date = toDateString(source.date)
  const isBefore =
    date < target.date ||
    (date === target.date &&
      MEAL_TYPE_ORDER.indexOf(source.mealType) < MEAL_TYPE_ORDER.indexOf(target.mealType))
  if (!isBefore) return 'notBefore'
  if (date < earliestDate) return 'tooOld'
  return null
}

/**
 * `findLeftoverSourceProblem` for the fridge meal that `entryId` becomes: the
 * entry `PATCH` knows the entry, not its slot. Null when there is no such
 * entry, so the write's own lookup answers 404.
 */
export async function findLeftoverProblemForEntry(
  householdId: string,
  entryId: string,
  items: readonly FridgeItemInput[],
): Promise<{ sourceEntryId: string; problem: LeftoverSourceProblem } | null> {
  if (!items.some((item) => 'sourceEntryId' in item)) return null
  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, plan: { householdId } },
    select: { date: true, mealType: true },
  })
  if (!entry) return null
  return findLeftoverSourceProblem(
    householdId,
    { date: toDateString(entry.date), mealType: entry.mealType, entryId },
    items,
  )
}
