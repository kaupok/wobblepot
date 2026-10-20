import type { Allergen, IngredientCategory, ProteinType, Unit } from '@/generated/prisma/enums'

/**
 * The rules for "Add as new ingredient" (HON-1263), shared by the form, the
 * route's schema and `createHouseholdIngredient`, so the three agree. Holds
 * no server import: the form is a client component.
 */

export const INGREDIENT_CATEGORIES = [
  'protein',
  'carb',
  'vegetable',
  'fruit',
  'dairy',
  'fat',
  'legume',
  'condiment',
  'spice',
] as const satisfies readonly IngredientCategory[]

/**
 * The protein types each category may carry, as the seed uses them. Every
 * other category stores none, so a vegetable never carries a meat type. The
 * category alone cannot decide it: the seed files oat milk under `dairy` with
 * `none`, so "vegan cheese" is `dairy` and `none`.
 */
export const PROTEIN_TYPES_BY_CATEGORY = {
  protein: ['poultry', 'beef', 'pork', 'lamb', 'fish', 'eggs', 'legume'],
  dairy: ['dairy', 'none'],
  legume: ['legume', 'none'],
} as const satisfies Partial<Record<IngredientCategory, readonly ProteinType[]>>

export type ProteinTypedCategory = keyof typeof PROTEIN_TYPES_BY_CATEGORY

export function isProteinTypedCategory(
  category: IngredientCategory,
): category is ProteinTypedCategory {
  return Object.hasOwn(PROTEIN_TYPES_BY_CATEGORY, category)
}

/** The protein type the form preselects: the category's usual one, none for `protein`. */
export function defaultProteinType(category: IngredientCategory): ProteinType | undefined {
  return category === 'dairy' || category === 'legume' ? category : undefined
}

export const NEW_INGREDIENT_NAME_MAX = 80
export const GRAMS_PER_PIECE_MAX = 5000

/** Upper bounds per 100 g, the seed validator's `THRESHOLDS` (`prisma/seed-validator.ts`). */
export const NUTRITION_MAX = {
  calories: 900,
  protein: 50,
  carbs: 100,
  fat: 100,
  fiber: 100,
} as const

export type NutritionField = keyof typeof NUTRITION_MAX

/** Nutrition is per 100 g, from the pack label. */
export interface NewIngredientInput {
  name: string
  category: IngredientCategory
  proteinType?: ProteinType | null
  defaultUnit: Unit
  gramsPerPiece?: number | null
  allergens: Allergen[]
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number | null
}
