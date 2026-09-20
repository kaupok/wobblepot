import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IngredientCategory, Unit } from '@/generated/prisma/enums'

vi.mock('@/lib/errors-client', () => ({
  captureClientError: vi.fn(),
}))

import { captureClientError } from '@/lib/errors-client'
import {
  convertToPrefilledData,
  reviewImaginedMeal,
  type ImaginedMealResponse,
} from './imagine-utils'

const mockCaptureClientError = vi.mocked(captureClientError)

function baseMeal(): ImaginedMealResponse {
  return {
    id: 'imagined-1',
    name: 'Chicken stir fry',
    description: 'Quick weeknight dinner',
    timeMinutes: 30,
    servings: 4,
    suitableFor: ['dinner'],
    kidFriendly: true,
    primaryProteinType: 'poultry',
    components: [],
    nutrition: { calories: 500, protein: 35, carbs: 40, fat: 15 },
    ingredients: [],
    allMatched: true,
  }
}

function matchedIngredient(
  overrides: {
    ingredientId?: string
    name?: string
    convertedQuantity?: number
    isVague?: boolean
    originalPhrase?: string
    lowConfidence?: boolean
    alternatives?: {
      id: string
      name: string
      category: IngredientCategory
      defaultUnit: Unit
      similarity: number
    }[]
  } = {},
) {
  return {
    type: 'matched' as const,
    extractedName: 'chicken breast',
    extractedQuantity: 500,
    extractedUnit: 'g',
    originalText: '500g chicken breast',
    ingredient: {
      id: overrides.ingredientId ?? 'ing-chicken',
      name: overrides.name ?? 'Chicken breast',
      category: 'protein' as IngredientCategory,
      defaultUnit: 'g' as Unit,
      gramsPerPiece: null,
      calories: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
    },
    convertedQuantity: overrides.convertedQuantity ?? 500,
    isVague: overrides.isVague ?? false,
    originalPhrase: overrides.originalPhrase,
    lowConfidence: overrides.lowConfidence,
    alternatives: overrides.alternatives,
  }
}

function unmatchedIngredient() {
  return {
    type: 'unmatched' as const,
    extractedName: 'exotic spice',
    extractedQuantity: 5,
    extractedUnit: 'g',
    originalText: '5g exotic spice',
    isVague: false,
    originalPhrase: undefined,
  }
}

describe('convertToPrefilledData', () => {
  it('converts a matched ingredient to a matched PrefilledIngredient', () => {
    const meal = baseMeal()
    meal.ingredients = [matchedIngredient()]

    const result = convertToPrefilledData(meal)

    expect(result.prefilledIngredients).toHaveLength(1)
    const first = result.prefilledIngredients[0]!
    expect(first.type).toBe('matched')
    expect(first.ingredient?.id).toBe('ing-chicken')
    expect(first.convertedQuantity).toBe(500)
    expect(first.isVague).toBe(false)
    expect((first as { lowConfidence?: boolean }).lowConfidence).toBeUndefined()
  })

  it('converts a low-confidence matched ingredient when alternatives are present', () => {
    const meal = baseMeal()
    meal.ingredients = [
      matchedIngredient({
        lowConfidence: true,
        alternatives: [
          {
            id: 'alt-1',
            name: 'Chicken thigh',
            category: 'protein' as IngredientCategory,
            defaultUnit: 'g' as Unit,
            similarity: 0.7,
          },
        ],
      }),
    ]

    const result = convertToPrefilledData(meal)

    const first = result.prefilledIngredients[0]!
    expect(first.type).toBe('low-confidence')
    expect(first.lowConfidence).toBe(true)
    expect(first.alternatives).toHaveLength(1)
    expect(first.alternatives?.[0]?.id).toBe('alt-1')
    expect(first.extractedName).toBe('chicken breast')
    expect(first.originalText).toBe('500g chicken breast')
  })

  it('treats a matched ingredient as matched when lowConfidence is true but alternatives are missing', () => {
    const meal = baseMeal()
    meal.ingredients = [matchedIngredient({ lowConfidence: true })]

    const result = convertToPrefilledData(meal)

    expect(result.prefilledIngredients[0]!.type).toBe('matched')
  })

  it('converts an unmatched ingredient to an unmatched PrefilledIngredient', () => {
    const meal = baseMeal()
    meal.ingredients = [unmatchedIngredient()]

    const result = convertToPrefilledData(meal)

    const first = result.prefilledIngredients[0]!
    expect(first.type).toBe('unmatched')
    expect(first.extractedName).toBe('exotic spice')
    expect(first.extractedQuantity).toBe(5)
    expect(first.extractedUnit).toBe('g')
    expect(first.originalText).toBe('5g exotic spice')
    expect(first.ingredient).toBeUndefined()
  })

  it('handles a mix of matched, low-confidence, and unmatched ingredients', () => {
    const meal = baseMeal()
    meal.ingredients = [
      matchedIngredient({ ingredientId: 'ing-a' }),
      matchedIngredient({
        ingredientId: 'ing-b',
        lowConfidence: true,
        alternatives: [
          {
            id: 'alt-b',
            name: 'Alt B',
            category: 'vegetable' as IngredientCategory,
            defaultUnit: 'g' as Unit,
            similarity: 0.5,
          },
        ],
      }),
      unmatchedIngredient(),
    ]

    const result = convertToPrefilledData(meal)

    expect(result.prefilledIngredients.map((i) => i.type)).toEqual([
      'matched',
      'low-confidence',
      'unmatched',
    ])
  })

  it('always sets preparationNotes and sourceUrl to null', () => {
    const meal = baseMeal()
    meal.ingredients = [matchedIngredient()]

    const result = convertToPrefilledData(meal)

    expect(result.preparationNotes).toBeNull()
    expect(result.sourceUrl).toBeNull()
  })

  it('carries over nullable description and timeMinutes', () => {
    const meal = baseMeal()
    meal.description = null
    meal.timeMinutes = null
    meal.ingredients = [matchedIngredient()]

    const result = convertToPrefilledData(meal)

    expect(result.description).toBeNull()
    expect(result.timeMinutes).toBeNull()
  })

  it('forwards top-level meal metadata unchanged', () => {
    const meal = baseMeal()
    meal.name = 'Mushroom risotto'
    meal.servings = 6
    meal.suitableFor = ['lunch', 'dinner']
    meal.kidFriendly = false
    meal.ingredients = [matchedIngredient()]

    const result = convertToPrefilledData(meal)

    expect(result.name).toBe('Mushroom risotto')
    expect(result.servings).toBe(6)
    expect(result.mealTypes).toEqual(['lunch', 'dinner'])
    expect(result.kidFriendly).toBe(false)
  })

  it('preserves originalPhrase on vague ingredients', () => {
    const meal = baseMeal()
    meal.ingredients = [matchedIngredient({ isVague: true, originalPhrase: 'to taste' })]

    const result = convertToPrefilledData(meal)

    const first = result.prefilledIngredients[0]!
    expect(first.isVague).toBe(true)
    expect(first.originalPhrase).toBe('to taste')
  })

  it('returns an empty prefilledIngredients array when the meal has no ingredients', () => {
    const meal = baseMeal()

    const result = convertToPrefilledData(meal)

    expect(result.prefilledIngredients).toEqual([])
  })
})

describe('reviewImaginedMeal', () => {
  const originalFetch = global.fetch

  function reviewableMeal(): ImaginedMealResponse {
    const meal = baseMeal()
    meal.components = [
      {
        ingredientId: 'ing-chicken',
        quantityPerServing: 400,
        ingredient: {
          id: 'ing-chicken',
          name: 'Chicken breast',
          category: 'protein' as IngredientCategory,
          defaultUnit: 'g' as Unit,
        },
      },
    ]
    meal.ingredients = [matchedIngredient({ convertedQuantity: 1600 })]
    return meal
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('folds the corrected quantities into components and matched ingredients', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          ingredients: [{ ingredientId: 'ing-chicken', quantityPerServing: 150 }],
        }),
        { status: 200 },
      ),
    )

    const result = await reviewImaginedMeal(reviewableMeal())

    expect(result.components[0]!.quantityPerServing).toBe(150)
    // Matched ingredients carry the *total*, so the correction is re-multiplied
    // by servings (4) — 150 per serving is 600 in total, not 150.
    expect((result.ingredients[0] as { convertedQuantity: number }).convertedQuantity).toBe(600)
    expect(mockCaptureClientError).not.toHaveBeenCalled()
  })

  it('leaves an ingredient the review did not mention untouched', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, ingredients: [] }), { status: 200 }),
      )

    const result = await reviewImaginedMeal(reviewableMeal())

    expect(result.components[0]!.quantityPerServing).toBe(400)
    expect((result.ingredients[0] as { convertedQuantity: number }).convertedQuantity).toBe(1600)
  })

  it('waits past the route maxDuration of 60s before giving up (HON-699)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, ingredients: [] }), { status: 200 }),
      )
    global.fetch = fetchMock
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

    await reviewImaginedMeal(reviewableMeal())

    // Below 60_000 the client throws away a review the server may still be
    // running, after the household has already been billed for it.
    expect(timeoutSpy).toHaveBeenCalledWith(65000)
    timeoutSpy.mockRestore()
  })

  it("reports a platform timeout, whose body is not the route's JSON (HON-699)", async () => {
    // Vercel kills the handler at `maxDuration` and serves its own error page,
    // so `captureApiError` never runs — this is the only side that sees it, and
    // it is the exact overrun the 65s client wait exists to observe.
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('<!DOCTYPE html>FUNCTION_INVOCATION_TIMEOUT', { status: 504 }),
      )

    const meal = reviewableMeal()
    const result = await reviewImaginedMeal(meal)

    expect(result).toEqual(meal)
    expect(mockCaptureClientError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('non-route 504') }),
      {
        route: '/api/meals/imagine/review',
        $exception_source: 'imagine.review',
        statusCode: 504,
      },
    )
  })

  it("reports a JSON body that is not the route's error shape", async () => {
    // Vercel's own errors nest an object under `error`. If a platform timeout
    // ever arrives as JSON rather than as the HTML page, it must still report —
    // this is what keeps the fix independent of the platform's body format.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'FUNCTION_INVOCATION_TIMEOUT' } }), {
        status: 504,
      }),
    )

    await reviewImaginedMeal(reviewableMeal())

    expect(mockCaptureClientError).toHaveBeenCalledTimes(1)
  })

  it('does not treat a bare JSON array body as the route answering', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('[]', { status: 502 }))

    await reviewImaginedMeal(reviewableMeal())

    // No string `error`, so it is not the route's shape — reported, not dropped.
    expect(mockCaptureClientError).toHaveBeenCalledTimes(1)
  })

  it('degrades without reporting when the route answers 504', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Reviewing the quantities took too long.' }), {
        status: 504,
      }),
    )

    const meal = reviewableMeal()
    const result = await reviewImaginedMeal(meal)

    expect(result).toEqual(meal)
    // A JSON body means the route itself answered, and it already captured this
    // server-side with the user and household attached; reporting it again here
    // would double-count it.
    expect(mockCaptureClientError).not.toHaveBeenCalled()
  })

  it('reports and still returns the meal when the request itself fails', async () => {
    const error = new DOMException('The operation timed out', 'TimeoutError')
    global.fetch = vi.fn().mockRejectedValue(error)

    const meal = reviewableMeal()
    const result = await reviewImaginedMeal(meal)

    // Degrades: the user still gets a usable meal, with the AI's original
    // quantities rather than the corrected ones.
    expect(result).toEqual(meal)
    // ...but a client-side abort reaches no server reporter, so this is the
    // only place a mis-sized budget becomes visible to us (HON-699).
    expect(mockCaptureClientError).toHaveBeenCalledWith(error, {
      route: '/api/meals/imagine/review',
      $exception_source: 'imagine.review',
    })
  })

  it('reports and still returns the meal when the response body is not JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }))

    const meal = reviewableMeal()
    const result = await reviewImaginedMeal(meal)

    expect(result).toEqual(meal)
    expect(mockCaptureClientError).toHaveBeenCalledTimes(1)
  })

  it('posts the per-serving quantities the route expects', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, ingredients: [] }), { status: 200 }),
      )
    global.fetch = fetchMock

    await reviewImaginedMeal(reviewableMeal())

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/meals/imagine/review')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      mealName: 'Chicken stir fry',
      servings: 4,
      ingredients: [
        { ingredientId: 'ing-chicken', name: 'Chicken breast', quantityPerServing: 400, unit: 'g' },
      ],
    })
  })
})
