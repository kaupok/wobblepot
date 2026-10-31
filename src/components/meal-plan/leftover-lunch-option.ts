import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'

import type { PlanEntry } from './types'

/**
 * Whether a dinner's menu offers "Cook for tomorrow's lunch too" (HON-1396):
 * `available`, or shown but `unavailable` with the reason the menu gives.
 */
export type LeftoverLunchOption =
  { state: 'available' } | { state: 'unavailable'; reason: 'recipeLunch' | 'cooked' }

/**
 * The option for each planned recipe dinner in `entries`, by entry id. A
 * dinner without one shows no action: it is not a planned recipe dinner, or
 * the next day's lunch already takes its leftovers, which that lunch's Edit
 * items changes.
 *
 * The server decides again on Confirm (`addLeftoverLunch`), so a lunch the
 * client has not loaded, past the last day shown, reads as empty here.
 */
export function getLeftoverLunchOptions(
  entries: readonly PlanEntry[],
): Map<string, LeftoverLunchOption> {
  const lunches = new Map(
    entries.flatMap((entry) => (entry.mealType === 'lunch' ? [[entry.date, entry]] : [])),
  )
  const options = new Map<string, LeftoverLunchOption>()
  for (const dinner of entries) {
    if (dinner.mealType !== 'dinner' || dinner.status !== 'planned') continue
    if (dinner.kind === 'fridge' || !dinner.meal) continue

    const day = parseLocalDate(dinner.date)
    day.setDate(day.getDate() + 1)
    const lunchDate = toDateString(day)
    const lunch = lunches.get(lunchDate)
    const linked =
      dinner.leftoversFor?.some((l) => l.date === lunchDate && l.mealType === 'lunch') ||
      lunch?.items?.some((item) => item.sourceEntryId === dinner.id)
    if (linked) continue

    options.set(dinner.id, optionFor(lunch))
  }
  return options
}

function optionFor(lunch: PlanEntry | undefined): LeftoverLunchOption {
  if (lunch?.status === 'completed') return { state: 'unavailable', reason: 'cooked' }
  if (lunch && lunch.kind !== 'fridge' && lunch.meal) {
    return { state: 'unavailable', reason: 'recipeLunch' }
  }
  return { state: 'available' }
}
