import type { HouseholdIngredient } from '@/lib/ingredients/household-ingredient'

/** Household rows for the Ingredients tab's tests and stories (HON-1264). */
export const lovage: HouseholdIngredient = {
  id: 'ing-lovage',
  name: 'lovage',
  category: 'vegetable',
  proteinType: null,
  defaultUnit: 'g',
  gramsPerPiece: null,
  allergens: [],
  calories: 36,
  protein: 3,
  carbs: 6,
  fat: 0.5,
  fiber: null,
}

export const speltPasta: HouseholdIngredient = {
  id: 'ing-spelt-pasta',
  name: 'spelt pasta',
  category: 'carb',
  proteinType: null,
  defaultUnit: 'g',
  gramsPerPiece: null,
  allergens: ['gluten', 'eggs'],
  calories: 350,
  protein: 13,
  carbs: 70,
  fat: 2.5,
  fiber: 8,
}
