import type { MealStatus } from './StatusSelect'
import type { MealType } from '@/generated/prisma/enums'

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
  kidFriendly: boolean
  timeMinutes?: number | null
  preparationNotes?: string | null
  components: MealComponent[]
  nutrition: NutritionData
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
  reason: string
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
  | 'gluten'
  | 'dairy'
  | 'eggs'
  | 'nuts'
  | 'peanuts'
  | 'soy'
  | 'fish'
  | 'shellfish'
  | 'sesame'

export interface HouseholdPreferencesData {
  dietaryType: DietaryType | null
  allergensToAvoid: Allergen[]
  restrictions: string[]
  weekdayMealTypes: MealType[]
  weekendMealTypes: MealType[]
}
