import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { serverEnv } from '@/lib/env'
import { REVIEW_MODEL } from './models'
import {
  buildReviewRequest,
  type ReviewIngredient,
  type ReviewedIngredients,
} from './review-request'
import { logAiSample } from './sampling'
import { toAiUsageStats, withUsageOnFailure, type AiUsageStats } from './usage'

export {
  ReviewedIngredientsSchema,
  type ReviewIngredient,
  type ReviewedIngredients,
} from './review-request'

/**
 * Sanity-check the AI's per-serving quantities for an imagined meal.
 *
 * `abortSignal` is the wall-clock budget for the AI call, owned by
 * `/api/meals/imagine/review`. It is a trailing positional parameter to match
 * `imagineMeals`, the sibling call site on the same flow (HON-694). Undefined
 * leaves the call unbounded, which is the pre-HON-699 behaviour and what the
 * tests that do not care about the budget rely on.
 */
export async function reviewMealQuantities(
  mealName: string,
  servings: number,
  ingredients: ReviewIngredient[],
  locale: string,
  onAiUsage?: (usage: AiUsageStats) => void,
  abortSignal?: AbortSignal,
): Promise<ReviewedIngredients> {
  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const request = buildReviewRequest({ mealName, servings, ingredients, locale })

  const startedAt = Date.now()

  const result = await withUsageOnFailure(REVIEW_MODEL, onAiUsage, () =>
    generateObject({
      ...request,
      model: anthropic(REVIEW_MODEL),
      // Wall-clock budget owned by `/api/meals/imagine/review` — shared by this
      // attempt and every retry, not a per-attempt timeout.
      abortSignal,
    }),
  )

  onAiUsage?.(toAiUsageStats(REVIEW_MODEL, result.usage, Date.now() - startedAt))

  await logAiSample({
    callSite: 'review-quantities',
    locale,
    input: {
      mealName,
      servings,
      ingredients: ingredients.map((ing) => ({
        name: ing.name,
        quantityPerServing: ing.quantityPerServing,
        unit: ing.unit,
      })),
    },
    output: result.object,
  })

  return result.object
}
