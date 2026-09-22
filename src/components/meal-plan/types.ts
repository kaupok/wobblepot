import type { MealStatus } from './StatusSelect'
import type { MealImageStatus, MealType } from '@/generated/prisma/enums'

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

export interface StructuredTips {
  equipment?: string[]
  steps?: string[]
  pitfalls: string[]
  tip?: string
}

export type EntryRating = 'up' | 'down'

export interface PlanEntry {
  id: string
  date: string
  mealType: MealType
  status: MealStatus
  rating: EntryRating | null
  meal: MealData | null
  preparationTips: StructuredTips | null
  note: string | null
  servingOverride: number | null
  /**
   * Whether completing this entry has already charged the pantry. The server
   * charges an entry at most once, even across a revert (HON-651), so the UI
   * must not preview a second deduction. Sent by `/api/entries` only.
   */
  pantryDeducted?: boolean
}

export interface MealPlan {
  id: string
  /** Computed from week context; not stored in DB */
  startDate?: string
  /** Computed from week context; not stored in DB */
  endDate?: string
  entries: PlanEntry[]
}

export interface AlternativeMeal {
  id: string
  name: string
  description?: string | null
  timeMinutes: number | null
  kidFriendly: boolean
  primaryProteinType: string
  suitableFor?: MealType[]
  components: MealComponent[]
  nutrition: NutritionData
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
  unit: 'g' | 'piece'
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
  label: string // "Today", "Tomorrow", "Wednesday Mar 28", etc.
  isToday: boolean
  isTomorrow: boolean
  isPast: boolean
  entries: PlanEntry[]
  emptySlots: MealType[]
}

export interface TimelineData {
  days: TimelineDay[]
  planId: string // needed for mutations
}
