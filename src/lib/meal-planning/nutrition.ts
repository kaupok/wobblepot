/**
 * Utilities for computing meal nutrition from ingredients.
 */

interface NutritionData {
  calories: number
  protein: number
  carbs: number
  fat: number
}

interface MealComponent {
  quantityPerServing: number
  ingredient: {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
}

/**
 * Compute nutrition from meal components.
 * Ingredients store nutrition per 100g, so we multiply by quantity and divide by 100.
 */
export function computeMealNutrition(components: MealComponent[]): NutritionData {
  return components.reduce(
    (acc, comp) => ({
      calories: acc.calories + (comp.ingredient.calories * comp.quantityPerServing) / 100,
      protein: acc.protein + (comp.ingredient.protein * comp.quantityPerServing) / 100,
      carbs: acc.carbs + (comp.ingredient.carbs * comp.quantityPerServing) / 100,
      fat: acc.fat + (comp.ingredient.fat * comp.quantityPerServing) / 100,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

/**
 * Format Date to YYYY-MM-DD string using local time.
 * Uses local date components to avoid timezone shifts.
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
