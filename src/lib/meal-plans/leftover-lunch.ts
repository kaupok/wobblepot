import 'server-only'

import { MealPlanEntryStatus, MealType } from '@/generated/prisma/enums'
import { isWeekday, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { getExpectedMealTypes } from '@/lib/meal-planning/expected-meal-types'
import { prisma } from '@/lib/prisma'

import { createEntry } from './create-entry'
import { FRIDGE_ITEMS_MAX, type FridgeItemInput } from './fridge-items'
import { setFridgeItems } from './fridge-meal'

/**
 * Why "Cook for tomorrow's lunch too" refused (HON-1396):
 *
 * - `dinnerNotFound`: no entry of this household's plan (404)
 * - `notPlannedDinner`: not a planned recipe dinner (409)
 * - `lunchOff`: the household does not plan lunch on the next day (409)
 * - `recipeLunch`: the next day's lunch is a recipe meal (409)
 * - `cooked`: the next day's lunch is cooked (409)
 * - `alreadyLinked`: that lunch already takes leftovers from this dinner (409)
 * - `lunchFull`: that lunch already holds `FRIDGE_ITEMS_MAX` items (409)
 */
export type LeftoverLunchRefusal =
  | 'dinnerNotFound'
  | 'notPlannedDinner'
  | 'lunchOff'
  | 'recipeLunch'
  | 'cooked'
  | 'alreadyLinked'
  | 'lunchFull'

export class LeftoverLunchError extends Error {
  constructor(readonly reason: LeftoverLunchRefusal) {
    super(`Leftover lunch refused: ${reason}`)
    this.name = 'LeftoverLunchError'
  }
}

/**
 * Adds one leftover item for a planned recipe dinner, at `servings`, to the
 * next day's lunch: a new fridge meal when that lunch is empty, or one more
 * item on the fridge meal it already is. The dinner's card offers this as
 * "Cook for tomorrow's lunch too".
 *
 * It writes through `createEntry` and `setFridgeItems`, as the picker does.
 * The refusals cover the source rule (`findLeftoverSourceProblem`): a planned
 * recipe dinner the day before, with servings, is always a source the lunch
 * may take. The lunch's stored items go back unchanged, as Edit items sends
 * them.
 */
export async function addLeftoverLunch(
  household: {
    id: string
    preferences: { weekdayMealTypes: MealType[]; weekendMealTypes: MealType[] } | null
  },
  planId: string,
  dinnerEntryId: string,
  servings: number,
): Promise<{ outcome: 'planned' | 'added'; date: string }> {
  const dinner = await prisma.mealPlanEntry.findFirst({
    where: { id: dinnerEntryId, planId, plan: { householdId: household.id } },
    select: { date: true, mealType: true, status: true, kind: true, mealId: true },
  })
  if (!dinner) throw new LeftoverLunchError('dinnerNotFound')
  if (
    dinner.mealType !== MealType.dinner ||
    dinner.status !== MealPlanEntryStatus.planned ||
    dinner.kind !== 'meal' ||
    dinner.mealId === null
  ) {
    throw new LeftoverLunchError('notPlannedDinner')
  }

  const lunchDay = new Date(dinner.date)
  lunchDay.setDate(lunchDay.getDate() + 1)
  const lunchDate = toDateString(lunchDay)
  // The timeline shows only the meal types that are on, so a lunch planned on
  // a day without lunch would not be seen.
  const expected = getExpectedMealTypes(household.preferences)
  const mealTypes = isWeekday(parseLocalDate(lunchDate))
    ? expected.weekdayMealTypes
    : expected.weekendMealTypes
  if (!mealTypes.includes(MealType.lunch)) throw new LeftoverLunchError('lunchOff')

  const lunch = await prisma.mealPlanEntry.findFirst({
    where: { plan: { householdId: household.id }, date: lunchDay, mealType: MealType.lunch },
    select: {
      id: true,
      planId: true,
      status: true,
      kind: true,
      mealId: true,
      items: {
        orderBy: { position: 'asc' },
        select: { ingredientId: true, sourceEntryId: true, servings: true, label: true },
      },
    },
  })
  const item: FridgeItemInput = { sourceEntryId: dinnerEntryId, servings }

  if (!lunch) {
    await createEntry(household.id, planId, {
      date: lunchDay,
      mealType: MealType.lunch,
      fridgeItems: [item],
    })
    return { outcome: 'planned', date: lunchDate }
  }
  if (lunch.status === MealPlanEntryStatus.completed) throw new LeftoverLunchError('cooked')
  if (lunch.kind === 'meal' && lunch.mealId !== null) throw new LeftoverLunchError('recipeLunch')
  if (lunch.items.some((stored) => stored.sourceEntryId === dinnerEntryId)) {
    throw new LeftoverLunchError('alreadyLinked')
  }
  // One more would be a fridge meal its own Edit items could not save.
  if (lunch.items.length >= FRIDGE_ITEMS_MAX) throw new LeftoverLunchError('lunchFull')

  // A note-only card or a picker placeholder becomes a fridge meal with the
  // one item, and keeps its note.
  await setFridgeItems(household.id, lunch.planId, lunch.id, [...lunch.items.map(toInput), item])
  return { outcome: lunch.kind === 'fridge' ? 'added' : 'planned', date: lunchDate }
}

/** A stored item as the routes take it, as `toFridgeItemInput` sends it from the client. */
function toInput(row: {
  ingredientId: string | null
  sourceEntryId: string | null
  servings: number | null
  label: string | null
}): FridgeItemInput {
  if (row.ingredientId !== null) return { ingredientId: row.ingredientId }
  if (row.sourceEntryId !== null) {
    return row.servings === null
      ? { sourceEntryId: row.sourceEntryId }
      : { sourceEntryId: row.sourceEntryId, servings: row.servings }
  }
  return { label: row.label ?? '' }
}
