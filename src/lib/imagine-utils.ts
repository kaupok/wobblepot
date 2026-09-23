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
 * Did this body come from the route handler rather than from something upstream
 * of it? Every non-ok answer the route writes is `NextResponse.json` with a
 * **string** `error` — 401, 404, the cap-exceeded 429, both 400s, the 504 and
 * the 500 (`review/route.ts`, and `respondCapExceeded` in `ai/usage.ts`).
 *
 * Matching that shape rather than merely "parses as JSON" is what makes this
 * independent of the platform's body format. Vercel's own errors are
 * `{ error: { code, message } }` — an *object* under `error` — so a
 * `FUNCTION_INVOCATION_TIMEOUT` is still reported even if it arrives as JSON
 * rather than as the HTML error page. A `startsWith('{')` sniff would have been
 * fooled by both.
 */
function isRouteJsonBody(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return false
    return typeof (parsed as { error?: unknown }).error === 'string'
  } catch {
    return false
  }
}

/**
 * The route's own rate-limit 429 (HON-722). Keyed on `code` rather than on the
 * status, so the shared AI cost-cap 429 (`ai_cap_exceeded`) is not swept in.
 * Only called on a body {@link isRouteJsonBody} already accepted.
 */
function isRateLimitedBody(body: string): boolean {
  return (JSON.parse(body) as { code?: unknown }).code === 'rate_limited'
}

/**
 * `$exception_source` tags it the way `app/error.tsx` does, so a degraded review
 * is separable in PostHog from a route-level error boundary. These captures are
 * the *only* trace of the failure, since the user is shown none.
 */
function report(error: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  return captureClientError(error, {
    route: '/api/meals/imagine/review',
    $exception_source: 'imagine.review',
    ...extra,
  })
}

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
 * Which failures get reported is deliberate, because the two sides do not cover
 * the same ground. The route's `captureApiError` call sits inside the one
 * try/catch around `reviewMealQuantities`, so it covers a thrown AI error and
 * nothing else: its 401/404/429/400 answers skip it (they are client-caused and
 * not worth an exception), and — the case that matters — the platform's own
 * `maxDuration` kill never reaches the handler at all, so nothing server-side
 * runs. That kill is reachable precisely because `AI_BUDGET_MS` bounds only the
 * AI call while the session, membership, cap and usage work sit outside it, and
 * it is the exact overrun the 65s wait above exists to observe.
 *
 * So: a non-ok answer *from the route* is left to the server's own capture, and
 * anything else — a body that is not the route's JSON, an abort, a network
 * failure — is reported here. Otherwise the "budget is mis-sized" signal this
 * whole change exists to surface would be invisible on both sides.
 *
 * Two route answers are reported here all the same. The rate-limit 429
 * (HON-722) degrades silently by decision like the timeout does, and the route
 * does not capture it — an abuse loop would turn that into one exception per
 * rejected request. A 400 means the route refused a payload this function built
 * (a meal past its ingredient or name-length bounds), which is our bug, not the
 * user's. Either way this is the only place a real user losing their
 * corrections shows up.
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

    if (!response.ok) {
      // A JSON body means the route answered and already captured it server-side
      // with the user and household attached. A non-JSON body means something
      // upstream of the handler did — Vercel's `FUNCTION_INVOCATION_TIMEOUT`
      // page, a proxy 502 — and nothing server-side saw it.
      const body = await response.text()
      if (!isRouteJsonBody(body)) {
        void report(new Error(`Review failed with a non-route ${response.status} response`), {
          statusCode: response.status,
        })
      } else if (isRateLimitedBody(body)) {
        void report(new Error('Review was rate limited'), { statusCode: response.status })
      } else if (response.status === 400) {
        // Our own payload was refused — a meal past the route's ingredient-count
        // or name-length bounds, or a client/schema drift. Returns before the
        // route's capture, so nothing server-side sees it either.
        void report(new Error('Review request was rejected as invalid'), {
          statusCode: response.status,
        })
      }
      return meal
    }

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
    void report(error)
    return meal
  }
}
