import { describe, it, expect } from 'vitest'
import { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { convertToPrefilledData, type ImaginedMealResponse } from './imagine-utils'

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
