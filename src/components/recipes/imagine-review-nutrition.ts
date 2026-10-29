import type { PrefilledIngredient } from '@/components/household/meal-form-types'
import type { NutritionData } from '@/components/meal-plan/types'
import { convertToPrefilledData, type ImaginedMealResponse } from '@/lib/imagine-utils'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'

import type { IngredientRowData } from './IngredientRow'

/**
 * Per-serving nutrition for the rows as they currently stand in the dialog.
 *
 * Derived from the live rows rather than the imagine response's `nutrition`,
 * which was computed before the AI quantity review and never sees a row edit or
 * removal (HON-721). Mirrors `POST /api/households/me/meals`, which stores
 * `totalQuantity / servings` and reduces it with the same `computeMealNutrition`,
 * so the summary shows what the saved meal will carry — piece units included.
 *
 * Returns `null` when there is nothing to sum, or when the total would be
 * partial: a non-vague unmatched row (no ingredient yet), or a row whose
 * ingredient lacks macros (one picked from the low-confidence alternatives
 * carries none). A partial total reads as trustworthy and is wrong, so the
 * caller hides the summary instead. Vague rows add nothing, matched or not.
 */
export function computeReviewNutrition(
  rows: IngredientRowData[],
  servings: number,
): NutritionData | null {
  const components = []
  for (const row of rows) {
    if (row.isVague) continue
    if (row.type === 'unmatched') return null
    const { calories, protein, carbs, fat } = row.ingredient
    if (calories == null || protein == null || carbs == null || fat == null) return null
    components.push({
      quantityPerServing: row.totalQuantity / servings,
      ingredient: { ...row.ingredient, calories, protein, carbs, fat },
    })
  }
  if (components.length === 0) return null
  return computeMealNutrition(components)
}

export function initIngredientRows(
  prefilledIngredients: PrefilledIngredient[],
  unknownName: string,
): IngredientRowData[] {
  const rows = prefilledIngredients.map((prefilled): IngredientRowData => {
    if (prefilled.type === 'unmatched') {
      return {
        type: 'unmatched',
        extractedName: prefilled.extractedName ?? unknownName,
        originalText: prefilled.originalText ?? '',
        extractedQuantity: prefilled.extractedQuantity ?? 0,
        extractedUnit: prefilled.extractedUnit ?? '',
        isVague: prefilled.isVague,
        originalPhrase: prefilled.originalPhrase,
      }
    }

    if (prefilled.type === 'low-confidence' && prefilled.ingredient && prefilled.alternatives) {
      return {
        type: 'low-confidence',
        extractedName: prefilled.extractedName ?? prefilled.ingredient.name,
        originalText: prefilled.originalText,
        ingredient: prefilled.ingredient,
        alternatives: prefilled.alternatives,
        totalQuantity: prefilled.convertedQuantity ?? 100,
        isVague: prefilled.isVague,
        originalPhrase: prefilled.originalPhrase,
      }
    }

    if (prefilled.ingredient) {
      return {
        type: 'matched',
        ingredient: prefilled.ingredient,
        totalQuantity: prefilled.convertedQuantity ?? 100,
        isVague: prefilled.isVague,
        originalPhrase: prefilled.originalPhrase,
      }
    }

    return {
      type: 'unmatched',
      extractedName: prefilled.extractedName ?? unknownName,
      originalText: prefilled.originalText ?? '',
      extractedQuantity: 0,
      extractedUnit: '',
    }
  })

  const typeOrder = { unmatched: 0, 'low-confidence': 1, matched: 2 }
  return rows.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])
}

/**
 * The idea with the nutrition its review dialog opens with, so the card and the
 * dialog never disagree on screen (HON-1367). The card's own `nutrition` is the
 * model's estimate, made before the quantity review. When the dialog would show
 * no summary (`computeReviewNutrition` is `null`), the estimate stays.
 */
export function withReviewNutrition(
  idea: ImaginedMealResponse,
  reviewed: ImaginedMealResponse,
): ImaginedMealResponse {
  const { prefilledIngredients, servings } = convertToPrefilledData(reviewed)
  // The unknown-row name never reaches the sum, so no translation is needed.
  const nutrition = computeReviewNutrition(initIngredientRows(prefilledIngredients, ''), servings)
  return nutrition ? { ...idea, nutrition } : idea
}
