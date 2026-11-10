import type { Allergen, IngredientCategory, ProteinType, Unit } from '@/generated/prisma/enums'

/**
 * A household's own ingredient as the Ingredients tab shows and edits it
 * (HON-1264). Holds no server import: the tab's client components read it.
 */
export interface HouseholdIngredient {
  id: string
  name: string
  category: IngredientCategory
  proteinType: ProteinType | null
  defaultUnit: Unit
  gramsPerPiece: number | null
  allergens: Allergen[]
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number | null
}

/**
 * What still holds a household ingredient, by the name the delete refusal
 * shows. `meals` counts live recipes, `deletedMealsInPlan` the deleted recipes
 * a meal plan entry uses, past or planned, and `deletedMealsRestorable` the
 * other deleted recipes a restore can still bring back. `mealPlan` sums the fridge items and
 * the swapped components of plan entries.
 */
export interface IngredientUses {
  meals: number
  deletedMealsInPlan: number
  deletedMealsRestorable: number
  pantry: number
  shoppingList: number
  mealPlan: number
  extras: number
}
