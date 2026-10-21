import type { MealImageFields } from './MealImageCard'
import type { MealImageStatus, MealType } from '@/generated/prisma/enums'
import type { RatingSignal } from '@/lib/meal-planning/candidate-score'
import type { DisplayUnit } from '@/lib/i18n/format-shopping-quantity'
import type { PreferenceConflict } from '@/lib/meal-planning/preference-conflicts'

export interface MealComponent {
  ingredientId: string
  quantityPerServing: number
  isVague?: boolean
  originalPhrase?: string | null
  ingredient: {
    id: string
    name: string
    category: string
    defaultUnit: 'g' | 'piece'
    gramsPerPiece?: number | null
    /** Shown in millilitres, 1 g = 1 ml (HON-1054). Absent reads as grams. */
    measuredByVolume?: boolean
  }
}

export interface NutritionData {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface MealData {
  id: string
  name: string
  description?: string | null
  kidFriendly: boolean
  /** `ProteinType` value; the planner card shows it as a badge beside the slot label. */
  primaryProteinType?: string
  timeMinutes?: number | null
  preparationNotes?: string | null
  components: MealComponent[]
  nutrition: NutritionData
  /** Household-owned meal. Only these generate an image on open (HON-737). */
  isCustom?: boolean
  /** Hero illustration in Vercel Blob, set once `imageStatus` is `ready` */
  imageUrl?: string | null
  imageStatus?: MealImageStatus
  /** OKLCH hue in degrees taken from the image, for the card tint (HON-744) */
  imageHue?: number | null
}

export interface PreparationSteps {
  equipment?: string[]
  steps?: string[]
  pitfalls: string[]
  tip?: string
}

export type EntryRating = 'up' | 'down'

export type MealStatus = 'planned' | 'completed' | 'skipped'

export interface PlanEntry {
  id: string
  date: string
  mealType: MealType
  status: MealStatus
  rating: EntryRating | null
  meal: MealData | null
  preparationTips: PreparationSteps | null
  note: string | null
  /**
   * Where the note's slip lies on the planner card, as fractions of the room it
   * moves in (`NotePosition`); both null for the default place (HON-975). Sent
   * by `/api/entries` only.
   */
  noteX?: number | null
  noteY?: number | null
  servingOverride: number | null
  /**
   * Whether completing this entry has already charged the pantry. The server
   * charges an entry at most once, even across a revert (HON-651), so the UI
   * must not preview a second deduction. Sent by `/api/entries` only.
   */
  pantryDeducted?: boolean
  /**
   * The household food preferences a planned meal breaks, one badge each on
   * the card and in the cook view (HON-1126). Empty for a cooked or skipped
   * entry. Sent by `/api/entries` only.
   */
  conflicts?: PreferenceConflict[]
  /**
   * This entry's own ingredient changes, oldest first (HON-1243). `meal.components`
   * already has them merged; this list is what the cook view shows as changed,
   * and what Undo reverts. Sent by `/api/entries` only.
   */
  changes?: EntryChange[]
  /**
   * The "Adjust recipe" instruction the steps follow (HON-1244), one request
   * per line; null without one. Sent by `/api/entries` only.
   */
  adjustmentNote?: string | null
  /**
   * `fridge` for a fridge meal (HON-1277): no `meal`, its `items` instead.
   * Absent reads as `meal`. Sent by `/api/entries` only.
   */
  kind?: 'meal' | 'fridge'
  /** A fridge meal's items, in order. Empty on every other kind. */
  items?: FridgeMealItem[]
}

/**
 * One item of a fridge meal. Exactly one of `ingredientId`, `sourceEntryId`
 * and `label` is set: a pantry ingredient, a recent meal's leftovers, or free
 * text.
 */
export interface FridgeMealItem {
  id: string
  ingredientId: string | null
  sourceEntryId: string | null
  label: string | null
  /** The ingredient's or the source meal's name; null for free text. */
  name: string | null
  /** The source meal's day, `YYYY-MM-DD`; null unless `sourceEntryId` is set. */
  sourceDate: string | null
}

/**
 * One change to one planned entry's ingredients (HON-1243):
 *
 * - `original` and `replacement`: the original is replaced.
 * - `original` only: the original is left out.
 * - `replacement` only: an added ingredient.
 */
export interface EntryChange {
  id: string
  original: { id: string; name: string } | null
  replacement: { id: string; name: string } | null
  /** Per serving, in the replacement's `defaultUnit`; null for a left-out ingredient. */
  quantityPerServing: number | null
  /**
   * The recipe was edited after the change: it no longer has the original, or
   * it now has the ingredient the change brings in. The change does nothing.
   */
  stale: boolean
}

export interface MealPlan {
  id: string
  /** Computed from week context; not stored in DB */
  startDate?: string
  /** Computed from week context; not stored in DB */
  endDate?: string
  entries: PlanEntry[]
}

export interface AlternativeMeal extends MealImageFields {
  id: string
  name: string
  description?: string | null
  timeMinutes: number | null
  kidFriendly: boolean
  primaryProteinType: string
  suitableFor?: MealType[]
  /** One of the household's own recipes, rather than a library meal (HON-948) */
  isCustom?: boolean
  components: MealComponent[]
  nutrition: NutritionData
  /**
   * Set when the household's own thumbs-up/down moved this suggestion's ranking (HON-340),
   * so the card can say so. Absent for a meal the household has not rated on balance.
   */
  ratingSignal?: RatingSignal
}

export interface WeekContext {
  type: 'last' | 'current' | 'next'
  daysCount: number
  isPartialWeek: boolean
  /** Start date of the week range (YYYY-MM-DD) for generation */
  startDate?: string
  /** End date of the week range (YYYY-MM-DD, exclusive) for generation */
  endDate?: string
}

export interface MealPlanWithContext extends MealPlan {
  weekContext: WeekContext
}

export interface MealAvailability {
  isReady: boolean
  missingCount: number
  missingIngredients: string[]
}

export interface PantryIngredient {
  ingredientId: string
  isStaple: boolean
}

export interface PantryItemFull {
  id: string
  ingredientId: string
  quantity: number | null
  isStaple: boolean
  ingredient: {
    id: string
    name: string
    category: string
    defaultUnit: 'g' | 'piece'
  }
}

export interface PantryDeductionItem {
  ingredientId: string
  ingredientName: string
  unit: DisplayUnit
  currentQuantity: number | null
  deductionAmount: number
  newQuantity: number | null // null means "will be removed"
  willBeRemoved: boolean
}

export interface ExpectedMealTypes {
  weekdayMealTypes: MealType[]
  weekendMealTypes: MealType[]
}

export interface EmptySlot {
  date: string
  mealType: MealType
}

export type DietaryType = 'vegetarian' | 'vegan' | 'pescatarian'
export type Allergen =
  'gluten' | 'dairy' | 'eggs' | 'nuts' | 'peanuts' | 'soy' | 'fish' | 'shellfish' | 'sesame'

export interface HouseholdPreferencesData {
  dietaryType: DietaryType | null
  allergensToAvoid: Allergen[]
  restrictions: string[]
  weekdayMealTypes: MealType[]
  weekendMealTypes: MealType[]
}

export interface TimelineDay {
  date: string // YYYY-MM-DD
  label: string // "Today", "Tomorrow", "Wednesday", etc.
  /** The date beside a named weekday ("Mar 28"), shown dimmed; absent on Today and Tomorrow. */
  dateLabel?: string
  isToday: boolean
  isTomorrow: boolean
  entries: PlanEntry[]
  emptySlots: MealType[]
}

export interface TimelineData {
  days: TimelineDay[]
  planId: string // needed for mutations
}
