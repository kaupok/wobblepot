import 'server-only'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { suggestForSlot, type SlotSuggestionHousehold } from '@/lib/meal-planning/slot-suggestions'
import { createEntry } from '@/lib/meal-plans/entries'

/** No meal passes the household's filters for the slot, so nothing was written. */
export class NoSuggestionsError extends Error {
  constructor() {
    super('No meal passes the filters for this slot')
    this.name = 'NoSuggestionsError'
  }
}

export interface PickSlot {
  /** YYYY-MM-DD, the household's local day. */
  date: string
  mealType: 'breakfast' | 'lunch' | 'dinner'
}

/**
 * Fills an empty slot with its top suggestion in one write: "Pick for me"
 * (HON-1248). The ranking is the pick, so there is no model call. The slot is
 * ranked before any row exists, so a slot nothing fits leaves no placeholder
 * behind.
 *
 * Throws `NoSuggestionsError` when no meal passes the filters, and
 * `EntryCreateError` for every `createEntry` refusal (a taken slot, a missing
 * plan or meal).
 */
export async function pickMealForSlot(
  household: SlotSuggestionHousehold,
  planId: string,
  slot: PickSlot,
  locale: string,
) {
  // `suggestForSlot` reads only the meal type in `add` mode, and the id seeds
  // the jitter, so a stand-in entry ranks the slot as the row would.
  const [top] = await suggestForSlot(
    household,
    { id: `${slot.date}:${slot.mealType}`, mealType: slot.mealType, mealId: null },
    'add',
    locale,
  )
  if (!top) throw new NoSuggestionsError()

  const entry = await createEntry(household.id, planId, {
    date: parseLocalDate(slot.date),
    mealType: slot.mealType,
    mealId: top.id,
  })
  return { ...entry, mealName: top.name }
}
