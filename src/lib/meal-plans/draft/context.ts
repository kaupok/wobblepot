import type { MealPlanEntryStatus, MealType } from '@/generated/prisma/enums'
import type { Locale } from '@/lib/i18n/locales'
import type { MealSlotFit } from '@/lib/meal-planning/meal-allowed-for-slot'
import type { AggregationComponent } from '@/lib/meal-planning/shopping-list'
import type { SlotSuggestionHousehold } from '@/lib/meal-planning/slot-suggestions'

import type { DraftSlot } from './schema'

/** The household fields a draft reads: its rules, its timezone and its locale. */
export interface DraftHousehold extends SlotSuggestionHousehold {
  timezone: string
  locale: string | null
}

/** A meal as the week shows it, its name in the household's locale. */
export interface DraftMealInfo {
  id: string
  name: string
  timeMinutes: number | null
  primaryProteinType: string
}

/** A stored entry of the household's plan, as the draft reads it. Dates are `YYYY-MM-DD`. */
export interface StoredEntry {
  id: string
  date: string
  mealType: MealType
  status: MealPlanEntryStatus
  kind: string
  mealId: string | null
  mainEntryId: string | null
  servingOverride: number | null
  cookedServings: number | null
  note: string | null
  /** Adjust recipe changes: ingredient changes or the instruction behind them. */
  hasChanges: boolean
  sideCount: number
  meal: DraftMealInfo | null
  items: {
    ingredientId: string | null
    sourceEntryId: string | null
    label: string | null
    servings: number | null
    /** The source entry's slot, for a leftover item. */
    source: { date: string; mealType: MealType } | null
  }[]
  /** The fridge meals that take leftovers from this entry. */
  leftoverItems: {
    servings: number | null
    entryId: string
    date: string
    mealType: MealType
    status: MealPlanEntryStatus
  }[]
}

/** A recipe meal the draft names, with the components its needs add up. */
export interface DraftMeal extends DraftMealInfo {
  components: AggregationComponent[]
}

/** What `rules`, `week`, `needs` and `previous` read: all of it loaded once by `load.ts`. */
export interface DraftContext {
  locale: Locale
  today: string
  lastDay: string
  householdServings: number
  /** Every loaded entry, mains and sides, by id. */
  stored: Map<string, StoredEntry>
  /** The stored main of each loaded slot, by `slotKey`. */
  mains: Map<string, StoredEntry>
  meals: Map<string, DraftMeal>
  /** `isMealAllowedForSlot` for each draft meal and meal type, by `fitKey`. */
  fits: Map<string, MealSlotFit>
  /** The draft's ingredient ids that the household can use. */
  ingredientIds: Set<string>
  pantry: Map<string, { quantity: number | null; low: boolean }>
}

export function fitKey(mealId: string, mealType: string): string {
  return `${mealId}|${mealType}`
}

/**
 * The plan as it is after the draft: each named slot (its first occurrence)
 * and, for any other slot, the stored main.
 */
export interface DraftView {
  named: Map<string, DraftSlot>
}
