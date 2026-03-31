import type {
  IngredientCategory,
  Allergen,
  ProteinType,
  Unit,
} from '../src/generated/prisma/client'

export type IngredientInput = {
  name: string
  category: IngredientCategory
  subcategory?: string
  proteinType?: ProteinType | null
  defaultUnit: Unit
  allergens: Allergen[]
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  gramsPerPiece?: number | null
  densityGPerMl?: number | null
}
