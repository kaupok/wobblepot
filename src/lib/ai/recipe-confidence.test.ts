import { describe, it, expect } from 'vitest'
import {
  evaluateRecipeConfidence,
  LOW_CONFIDENCE_THRESHOLD,
  VERY_LOW_CONFIDENCE_THRESHOLD,
} from './recipe-confidence'
import { SIMILARITY_THRESHOLD } from './fuzzy-ingredient-match'
import type { RecipeExtraction } from './recipe-schema'

describe('evaluateRecipeConfidence', () => {
  const makeExtraction = (overrides: Partial<RecipeExtraction> = {}): RecipeExtraction => ({
    name: 'Test Recipe',
    description: 'A test recipe',
    preparationNotes: null,
    timeMinutes: 30,
    servings: 4,
    mealTypes: ['dinner'],
    kidFriendly: true,
    recipeConfidence: 90,
    ingredients: [
      {
        name: 'chicken breast',
        quantity: 500,
        unit: 'g',
        originalText: '500g chicken breast',
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      },
      {
        name: 'olive oil',
        quantity: 2,
        unit: 'tbsp',
        originalText: '2 tbsp olive oil',
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      },
      {
        name: 'garlic',
        quantity: 3,
        unit: 'piece',
        originalText: '3 cloves garlic',
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      },
    ],
    ...overrides,
  })

  it('returns high tier for confident recipe', () => {
    const result = evaluateRecipeConfidence(makeExtraction())
    expect(result.tier).toBe('high')
    expect(result.message).toBeUndefined()
  })

  it('returns medium tier for borderline confidence', () => {
    const result = evaluateRecipeConfidence(makeExtraction({ recipeConfidence: 50 }))
    expect(result.tier).toBe('medium')
    expect(result.message).toBeDefined()
  })

  it('returns low tier for very low confidence', () => {
    const result = evaluateRecipeConfidence(makeExtraction({ recipeConfidence: 20 }))
    expect(result.tier).toBe('low')
    expect(result.message).toBeDefined()
  })

  // Pattern guards
  it('rejects name starting with Error', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({ name: 'Error: No Recipe Found', recipeConfidence: 80 }),
    )
    expect(result.tier).toBe('low')
  })

  it('rejects name containing Not Found', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({ name: 'Recipe Not Found', recipeConfidence: 80 }),
    )
    expect(result.tier).toBe('low')
  })

  it('rejects name that is N/A', () => {
    const result = evaluateRecipeConfidence(makeExtraction({ name: 'N/A', recipeConfidence: 80 }))
    expect(result.tier).toBe('low')
  })

  it('rejects name that is Untitled', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({ name: 'Untitled', recipeConfidence: 80 }),
    )
    expect(result.tier).toBe('low')
  })

  it('rejects ingredients with placeholder names', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({
        recipeConfidence: 90,
        ingredients: [
          {
            name: 'placeholder ingredient',
            quantity: 100,
            unit: 'g',
            originalText: '100g placeholder',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      }),
    )
    expect(result.tier).toBe('low')
  })

  it('rejects ingredients with error names', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({
        recipeConfidence: 90,
        ingredients: [
          {
            name: 'error',
            quantity: 100,
            unit: 'g',
            originalText: 'error',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      }),
    )
    expect(result.tier).toBe('low')
  })

  // Heuristic: vague ingredient ratio
  it('lowers confidence when most ingredients are vague', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({
        recipeConfidence: 70,
        ingredients: [
          {
            name: 'salt',
            quantity: null,
            unit: null,
            originalText: 'salt to taste',
            isVague: true,
            vaguePhrase: 'to taste',
            isDried: null,
          },
          {
            name: 'pepper',
            quantity: null,
            unit: null,
            originalText: 'pepper to taste',
            isVague: true,
            vaguePhrase: 'to taste',
            isDried: null,
          },
          {
            name: 'oil',
            quantity: null,
            unit: null,
            originalText: 'oil as needed',
            isVague: true,
            vaguePhrase: 'as needed',
            isDried: null,
          },
        ],
      }),
    )
    // 70 - 20 (vague ratio) = 50 → medium
    expect(result.tier).toBe('medium')
  })

  // Heuristic: identical quantities
  it('lowers confidence when all quantities are identical', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({
        recipeConfidence: 70,
        ingredients: [
          {
            name: 'flour',
            quantity: 1,
            unit: 'piece',
            originalText: '1 flour',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
          {
            name: 'sugar',
            quantity: 1,
            unit: 'piece',
            originalText: '1 sugar',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
          {
            name: 'butter',
            quantity: 1,
            unit: 'piece',
            originalText: '1 butter',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      }),
    )
    // 70 - 25 (identical) = 45 → medium
    expect(result.tier).toBe('medium')
  })

  // Heuristic: low ingredient count with no quantities
  it('lowers confidence for few ingredients with no quantities', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({
        recipeConfidence: 55,
        ingredients: [
          {
            name: 'dough',
            quantity: null,
            unit: null,
            originalText: 'dough',
            isVague: true,
            vaguePhrase: 'some',
            isDried: null,
          },
          {
            name: 'sauce',
            quantity: null,
            unit: null,
            originalText: 'sauce',
            isVague: true,
            vaguePhrase: 'some',
            isDried: null,
          },
        ],
      }),
    )
    // 55 - 30 (low count) - 20 (vague ratio) = 5 → low
    expect(result.tier).toBe('low')
  })

  // Combined heuristics can push from high to low
  it('stacks heuristic penalties', () => {
    const result = evaluateRecipeConfidence(
      makeExtraction({
        recipeConfidence: 65,
        ingredients: [
          {
            name: 'item1',
            quantity: 1,
            unit: 'piece',
            originalText: '1 item1',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
          {
            name: 'item2',
            quantity: 1,
            unit: 'piece',
            originalText: '1 item2',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
          {
            name: 'item3',
            quantity: 1,
            unit: 'piece',
            originalText: '1 item3',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      }),
    )
    // 65 - 25 (identical) = 40 → medium
    expect(result.tier).toBe('medium')
  })

  it('does not penalize varied real quantities', () => {
    const result = evaluateRecipeConfidence(makeExtraction({ recipeConfidence: 75 }))
    // 75 with no penalties → high
    expect(result.tier).toBe('high')
  })
})

describe('confidence thresholds', () => {
  it('has valid LOW_CONFIDENCE_THRESHOLD', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBeGreaterThan(0)
    expect(LOW_CONFIDENCE_THRESHOLD).toBeLessThan(1)
  })

  it('has valid SIMILARITY_THRESHOLD', () => {
    expect(SIMILARITY_THRESHOLD).toBeGreaterThan(0)
    expect(SIMILARITY_THRESHOLD).toBeLessThan(1)
    expect(SIMILARITY_THRESHOLD).toBeLessThan(VERY_LOW_CONFIDENCE_THRESHOLD)
  })

  it('has valid VERY_LOW_CONFIDENCE_THRESHOLD', () => {
    expect(VERY_LOW_CONFIDENCE_THRESHOLD).toBeGreaterThan(SIMILARITY_THRESHOLD)
    expect(VERY_LOW_CONFIDENCE_THRESHOLD).toBeLessThan(LOW_CONFIDENCE_THRESHOLD)
  })
})
