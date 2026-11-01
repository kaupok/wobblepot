import type { ExpectedMealTypes, PlanEntry } from '@/components/meal-plan/types'
import { MealType } from '@/generated/prisma/enums'
import { isWeekday } from '@/lib/meal-planning/dates'

const mealTypeOrder: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2 }

/**
 * One day's entries as cards or rows, breakfast to dinner, and its empty
 * slots: the household's expected meal types for that weekday with no entry.
 *
 * An entry with no meal and no note is a picker placeholder whose discard
 * never ran (the tab closed with the picker open), so its slot is empty
 * (HON-1251). A note with no meal stays and fills its slot: the slip is the
 * household's writing (HON-975), and `createEntry` refuses a second entry
 * there. A fridge meal stays too, with items instead of a meal (HON-1277).
 * Today and Past meals both read through this.
 *
 * `otherSlots` are the meal types the day does not expect and has no entry
 * for, breakfast to dinner. Today's Add menu offers them after the expected
 * slots, so a dinner-only household can add one breakfast (HON-1518).
 *
 * `hasExpectedEntry` is true when an entry fills one of the expected slots.
 * An off-type entry alone leaves it false, so the fill bar still treats the
 * day as unplanned (HON-1541).
 */
export function daySlots(
  date: Date,
  entries: PlanEntry[],
  expectedMealTypes: ExpectedMealTypes,
): {
  entries: PlanEntry[]
  emptySlots: MealType[]
  otherSlots: MealType[]
  hasExpectedEntry: boolean
} {
  const expectedTypes = isWeekday(date)
    ? expectedMealTypes.weekdayMealTypes
    : expectedMealTypes.weekendMealTypes
  const dayEntries = entries
    .filter((e) => e.meal !== null || e.note !== null || e.kind === 'fridge')
    .sort((a, b) => (mealTypeOrder[a.mealType] ?? 3) - (mealTypeOrder[b.mealType] ?? 3))
  const existingTypes = new Set(dayEntries.map((e) => e.mealType))
  return {
    entries: dayEntries,
    emptySlots: expectedTypes.filter((mt) => !existingTypes.has(mt)),
    otherSlots: Object.values(MealType).filter(
      (mt) => !existingTypes.has(mt) && !expectedTypes.includes(mt),
    ),
    hasExpectedEntry: expectedTypes.some((mt) => existingTypes.has(mt)),
  }
}
