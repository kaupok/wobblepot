import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'
import type { PrefilledIngredient } from '@/components/household/meal-form-types'
import type { MealCardBaseData } from '@/components/meal-plan/MealCardBase'
import { captureClientError } from '@/lib/errors-client'

interface IngredientAlternative {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  similarity: number
}

interface MatchedIngredient {
  type: 'matched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    gramsPerPiece: number | null
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
  }
  convertedQuantity: number
  isVague: boolean
  originalPhrase?: string
  similarityScore?: number
  lowConfidence?: boolean
  alternatives?: IngredientAlternative[]
}

interface UnmatchedIngredient {
  type: 'unmatched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  isVague: boolean
  originalPhrase?: string
}

export type IngredientMatchResult = MatchedIngredient | UnmatchedIngredient

export interface ImaginedMealResponse {
  id: string
  name: string
  description: string | null
  timeMinutes: number | null
  servings: number
  suitableFor: MealType[]
  kidFriendly: boolean
  primaryProteinType: string
  components: MealCardBaseData['components']
  nutrition: MealCardBaseData['nutrition']
  ingredients: IngredientMatchResult[]
  allMatched: boolean
}

export function convertToPrefilledData(meal: ImaginedMealResponse): {
  name: string
  description: string | null
  preparationNotes: string | null
  sourceUrl: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  prefilledIngredients: PrefilledIngredient[]
} {
  const prefilledIngredients: PrefilledIngredient[] = meal.ingredients.map((ingredient) => {
    if (ingredient.type === 'unmatched') {
      return {
        type: 'unmatched' as const,
        extractedName: ingredient.extractedName,
        originalText: ingredient.originalText,
        extractedQuantity: ingredient.extractedQuantity,
        extractedUnit: ingredient.extractedUnit,
        isVague: ingredient.isVague,
        originalPhrase: ingredient.originalPhrase,
      }
    }

    if (ingredient.lowConfidence && ingredient.alternatives) {
      return {
        type: 'low-confidence' as const,
        ingredient: {
          id: ingredient.ingredient.id,
          name: ingredient.ingredient.name,
          category: ingredient.ingredient.category,
          defaultUnit: ingredient.ingredient.defaultUnit,
          gramsPerPiece: ingredient.ingredient.gramsPerPiece,
          calories: ingredient.ingredient.calories,
          protein: ingredient.ingredient.protein,
          carbs: ingredient.ingredient.carbs,
          fat: ingredient.ingredient.fat,
        },
        convertedQuantity: ingredient.convertedQuantity,
        isVague: ingredient.isVague,
        originalPhrase: ingredient.originalPhrase,
        lowConfidence: true,
        alternatives: ingredient.alternatives,
        extractedName: ingredient.extractedName,
        originalText: ingredient.originalText,
      }
    }

    return {
      type: 'matched' as const,
      ingredient: {
        id: ingredient.ingredient.id,
        name: ingredient.ingredient.name,
        category: ingredient.ingredient.category,
        defaultUnit: ingredient.ingredient.defaultUnit,
        gramsPerPiece: ingredient.ingredient.gramsPerPiece,
        calories: ingredient.ingredient.calories,
        protein: ingredient.ingredient.protein,
        carbs: ingredient.ingredient.carbs,
        fat: ingredient.ingredient.fat,
      },
      convertedQuantity: ingredient.convertedQuantity,
      isVague: ingredient.isVague,
      originalPhrase: ingredient.originalPhrase,
    }
  })

  return {
    name: meal.name,
    description: meal.description,
    preparationNotes: null,
    sourceUrl: null,
    timeMinutes: meal.timeMinutes,
    servings: meal.servings,
    mealTypes: meal.suitableFor,
    kidFriendly: meal.kidFriendly,
    prefilledIngredients,
  }
}

/**
 * How long the client waits before giving up on `/api/meals/imagine/review`.
 *
 * Must stay *above* that route's `maxDuration` of 60s. It used to be 45s, under
 * the ceiling: a review that ran past 45s was thrown away client-side even
 * though the household had already been billed for it, and the server's own
 * response never reached us (HON-699). Waiting past the platform ceiling means
 * the request always resolves — with corrections, or with a mapped error.
 */
const REVIEW_TIMEOUT_MS = 65000

/**
 * Ask `/api/meals/imagine/review` to sanity-check an imagined meal's
 * per-serving quantities, and fold any corrections back into the meal.
 *
 * Degrades rather than throwing: a failed review costs the corrections, not the
 * meal, and the user never asked for the review by name — surfacing an error
 * would turn a partial success into a blocking one (HON-699). But the failure
 * *is* reported, so a mis-sized server budget is visible to us without being
 * visible to them.
 *
 * Only the `catch` reports. A non-ok response was already captured server-side
 * by `captureApiError` with the route, user and household attached; reporting
 * it again here would double-count it. What reaches no server reporter is an
 * abort or a network failure, which is exactly what lands in the `catch`.
 *
 * Shared by `ImagineClient` (the `/recipes/imagine` page) and `ImaginePanel`
 * (the meal-plan selector), which ran byte-identical copies of this before.
 */
export async function reviewImaginedMeal(
  meal: ImaginedMealResponse,
): Promise<ImaginedMealResponse> {
  try {
    const response = await fetch('/api/meals/imagine/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mealName: meal.name,
        servings: meal.servings,
        ingredients: meal.components.map((comp) => ({
          ingredientId: comp.ingredientId,
          name: comp.ingredient.name,
          quantityPerServing: comp.quantityPerServing,
          unit: comp.ingredient.defaultUnit,
        })),
      }),
      signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    })

    if (!response.ok) return meal

    const data = (await response.json()) as {
      success?: boolean
      ingredients?: { ingredientId: string; quantityPerServing: number }[]
    }
    if (!data.success || !data.ingredients) return meal

    const correctionMap = new Map<string, number>(
      data.ingredients.map((ing) => [ing.ingredientId, ing.quantityPerServing]),
    )

    return {
      ...meal,
      components: meal.components.map((comp) => {
        const corrected = correctionMap.get(comp.ingredientId)
        return corrected != null ? { ...comp, quantityPerServing: corrected } : comp
      }),
      ingredients: meal.ingredients.map((ing) => {
        if (ing.type !== 'matched') return ing
        const corrected = correctionMap.get(ing.ingredient.id)
        return corrected != null ? { ...ing, convertedQuantity: corrected * meal.servings } : ing
      }),
    }
  } catch (error) {
    // `$exception_source` tags it the way `app/error.tsx` does, so a degraded
    // review is separable in PostHog from a route-level error boundary — this
    // capture is the *only* trace of the failure, since the user sees none.
    void captureClientError(error, {
      route: '/api/meals/imagine/review',
      $exception_source: 'imagine.review',
    })
    return meal
  }
}
