import { isWeekday } from '@/lib/meal-planning/dates'
import type { ExpectedMealTypes, PlanEntry } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

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
 */
export function daySlots(
  date: Date,
  entries: PlanEntry[],
  expectedMealTypes: ExpectedMealTypes,
): { entries: PlanEntry[]; emptySlots: MealType[] } {
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
  }
}
