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
  components: MealComponent[]
  nutrition: NutritionData
}

export interface PlanEntry {
  id: string
  date: string
  mealType: MealType
  status: MealStatus
  meal: MealData | null
  preparationTips: string | null
  note: string | null
}

export interface MealPlan {
  id: string
  startDate: string
  endDate: string
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
