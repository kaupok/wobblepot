import type { MealStatus } from './StatusSelect'
import type { MealType } from '@/generated/prisma/enums'

export interface MealComponent {
  quantityPerServing: number
  ingredient: {
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
  timeMinutes: number | null
  kidFriendly: boolean
  primaryProteinType: string
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
