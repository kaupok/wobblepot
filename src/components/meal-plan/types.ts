import type { MealStatus } from './StatusSelect'

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
  status: MealStatus
  meal: MealData | null
}

export interface MealPlan {
  id: string
  startDate: string
  endDate: string
  entries: PlanEntry[]
}
