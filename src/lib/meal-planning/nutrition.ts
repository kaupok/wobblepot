/**
 * Utilities for computing meal nutrition from ingredients.
 */

import type { Unit } from '@/generated/prisma/enums'
import { DEFAULT_GRAMS_PER_PIECE } from '@/lib/ai/recipe-quantities'

interface NutritionData {
  calories: number
  protein: number
  carbs: number
  fat: number
}

interface ComponentUnit {
  defaultUnit: Unit | string
  gramsPerPiece?: number | null
}

interface MealComponent {
  quantityPerServing: number
  /** Vague components ("to taste") carry no reliable quantity and add nothing. */
  isVague?: boolean
  ingredient: ComponentUnit & {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
}

/**
 * Grams per serving for a component quantity.
 *
 * `MealComponent.quantityPerServing` is stored in the ingredient's
 * `defaultUnit` (HON-713): pieces for a piece-unit ingredient, grams otherwise.
 * A piece ingredient without `gramsPerPiece` falls back to
 * `DEFAULT_GRAMS_PER_PIECE`, the same default `convertQuantity` uses.
 */
export function componentGramsPerServing(
  quantityPerServing: number,
  ingredient: ComponentUnit,
): number {
  if (ingredient.defaultUnit !== 'piece') return quantityPerServing
  const gramsPerPiece =
    ingredient.gramsPerPiece && ingredient.gramsPerPiece > 0
      ? ingredient.gramsPerPiece
      : DEFAULT_GRAMS_PER_PIECE
  return quantityPerServing * gramsPerPiece
}

/**
 * Compute per-serving nutrition from meal components.
 * Ingredients store nutrition per 100g, so each component's quantity is
 * converted to grams and divided by 100. Vague components are skipped.
 */
export function computeMealNutrition(components: MealComponent[]): NutritionData {
  return components.reduce(
    (acc, comp) => {
      if (comp.isVague) return acc
      const grams = componentGramsPerServing(comp.quantityPerServing, comp.ingredient)
      return {
        calories: acc.calories + (comp.ingredient.calories * grams) / 100,
        protein: acc.protein + (comp.ingredient.protein * grams) / 100,
        carbs: acc.carbs + (comp.ingredient.carbs * grams) / 100,
        fat: acc.fat + (comp.ingredient.fat * grams) / 100,
      }
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )
}
