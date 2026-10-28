import { describe, it, expect } from 'vitest'
import { DEFAULT_GRAMS_PER_PIECE } from '@/lib/ai/recipe-quantities'
import type { ImaginedMealResponse } from '@/lib/imagine-utils'
import { computeReviewNutrition, withReviewNutrition } from './imagine-review-nutrition'
import type { IngredientRowData } from './IngredientRow'

// HON-721: the dialog's nutrition is derived from the live rows, through the same
// `computeMealNutrition` the save endpoint uses, instead of the imagine
// response's `nutrition` — which predates the AI quantity review and never
// sees a row edit or removal.
describe('computeReviewNutrition', () => {
  const grams = (overrides: Partial<Extract<IngredientRowData, { type: 'matched' }>> = {}) =>
    ({
      type: 'matched',
      ingredient: {
        id: 'rice',
        name: 'Rice',
        category: 'carb',
        defaultUnit: 'g',
        gramsPerPiece: null,
        calories: 350,
        protein: 7,
        carbs: 78,
        fat: 1,
      },
      totalQuantity: 400,
      ...overrides,
    }) satisfies IngredientRowData

  const eggs: IngredientRowData = {
    type: 'matched',
    ingredient: {
      id: 'egg',
      name: 'Egg',
      category: 'protein',
      defaultUnit: 'piece',
      gramsPerPiece: 55,
      calories: 155,
      protein: 13,
      carbs: 1,
      fat: 11,
    },
    totalQuantity: 8,
  }

  it('divides by servings and scales per-100g macros for gram rows', () => {
    // 400 g / 4 servings = 100 g per serving.
    expect(computeReviewNutrition([grams()], 4)).toEqual({
      calories: 350,
      protein: 7,
      carbs: 78,
      fat: 1,
    })
  })

  it('converts piece rows through gramsPerPiece, as the save endpoint does', () => {
    // 8 eggs / 4 servings = 2 eggs × 55 g = 110 g per serving.
    expect(computeReviewNutrition([eggs], 4)?.calories).toBeCloseTo(170.5)
  })

  it('falls back to the default piece weight when gramsPerPiece is missing', () => {
    const row = {
      ...eggs,
      ingredient: { ...eggs.ingredient, gramsPerPiece: null },
    } as IngredientRowData
    expect(computeReviewNutrition([row], 4)?.calories).toBeCloseTo(
      (2 * DEFAULT_GRAMS_PER_PIECE * 155) / 100,
    )
  })

  const unmatched: IngredientRowData = {
    type: 'unmatched',
    extractedName: 'yuzu',
    originalText: '1 yuzu',
    extractedQuantity: 1,
    extractedUnit: '',
  }

  it('counts low-confidence rows and skips vague ones, matched or not', () => {
    const rows: IngredientRowData[] = [
      grams(),
      { ...grams(), type: 'low-confidence', extractedName: 'rice', alternatives: [] },
      grams({ isVague: true, originalPhrase: 'to taste' }),
      { ...unmatched, extractedName: 'salt', isVague: true, originalPhrase: 'to taste' },
    ]
    expect(computeReviewNutrition(rows, 4)?.calories).toBe(700)
  })

  it('returns null rather than a partial total while a row is still unmatched', () => {
    expect(computeReviewNutrition([grams(), unmatched], 4)).toBeNull()
  })

  it('returns null rather than a partial total when a counted row has no macros', () => {
    // A row picked from the low-confidence alternatives carries no macros.
    const bare = grams({
      ingredient: { id: 'miso', name: 'Miso', category: 'condiment', defaultUnit: 'g' },
    })
    expect(computeReviewNutrition([grams(), bare], 4)).toBeNull()
  })

  it('ignores missing macros on a vague row, which contributes nothing anyway', () => {
    const bareVague = grams({
      ingredient: { id: 'salt', name: 'Salt', category: 'condiment', defaultUnit: 'g' },
      isVague: true,
    })
    expect(computeReviewNutrition([grams(), bareVague], 4)?.calories).toBe(350)
  })

  it('returns null when there is nothing to sum', () => {
    expect(computeReviewNutrition([], 4)).toBeNull()
    expect(computeReviewNutrition([grams({ isVague: true })], 4)).toBeNull()
  })
})

// HON-1367: the card takes the numbers the dialog opens with.
describe('withReviewNutrition', () => {
  const lentils = {
    type: 'matched',
    extractedName: 'red lentils',
    extractedQuantity: 360,
    extractedUnit: 'g',
    originalText: '360 g red lentils',
    ingredient: {
      id: 'ing-lentil',
      name: 'Red lentils',
      category: 'protein',
      defaultUnit: 'g',
      gramsPerPiece: null,
      calories: 350,
      protein: 24,
      carbs: 60,
      fat: 1.5,
    },
    convertedQuantity: 360,
    isVague: false,
  }
  const idea = {
    id: 'im-1',
    name: 'Lentil soup',
    description: null,
    timeMinutes: 25,
    servings: 4,
    suitableFor: ['dinner'],
    kidFriendly: false,
    primaryProteinType: 'legume',
    components: [],
    nutrition: { calories: 480, protein: 24, carbs: 62, fat: 12 },
    ingredients: [lentils],
    allMatched: true,
  } as unknown as ImaginedMealResponse

  it("replaces the estimate with the reviewed rows' per-serving sum", () => {
    // The review doubled the lentils: 720 g / 4 servings = 180 g per serving.
    const reviewed = {
      ...idea,
      ingredients: [{ ...lentils, convertedQuantity: 720 }],
    } as unknown as ImaginedMealResponse
    expect(withReviewNutrition(idea, reviewed).nutrition).toEqual({
      calories: 630,
      protein: 43.2,
      carbs: 108,
      fat: 2.7,
    })
  })

  it('keeps the rest of the idea as it was', () => {
    const result = withReviewNutrition(idea, idea)
    expect(result).toEqual({ ...idea, nutrition: expect.anything() })
    expect(result.nutrition.calories).toBe(315)
  })

  it('keeps the estimate when the dialog would show no summary', () => {
    const reviewed = {
      ...idea,
      ingredients: [
        lentils,
        {
          type: 'unmatched',
          extractedName: 'yuzu',
          originalText: '1 yuzu',
          extractedQuantity: 1,
          extractedUnit: '',
          isVague: false,
        },
      ],
    } as unknown as ImaginedMealResponse
    expect(withReviewNutrition(idea, reviewed)).toBe(idea)
  })
})
