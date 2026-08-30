import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}))

vi.mock('@/lib/env', () => ({
  serverEnv: { ANTHROPIC_API_KEY: 'test-key' },
}))

vi.mock('./sampling', () => ({
  logAiSample: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { generateObject } from 'ai'
import {
  parseRecipeText,
  matchIngredients,
  mergeDuplicateIngredients,
  parseAndMatchRecipe,
} from './parse-recipe'
import type { IngredientMatchResult, MatchedIngredient, UnmatchedIngredient } from './parse-recipe'
import type { ExtractedIngredient, RecipeExtraction } from './recipe-schema'
import { RecipeParseError } from './recipe-errors'

const mockQueryRaw = vi.mocked(prisma.$queryRaw)
const mockGenerateObject = vi.mocked(generateObject)

import { logAiSample } from './sampling'
const mockLogAiSample = vi.mocked(logAiSample)

describe('parseRecipeText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws RecipeParseError for text shorter than 20 characters', async () => {
    await expect(parseRecipeText('too short')).rejects.toThrow(RecipeParseError)
    await expect(parseRecipeText('too short')).rejects.toThrow(
      'The text is too short to be a recipe',
    )
  })

  it('throws RecipeParseError for whitespace-only short text', async () => {
    await expect(parseRecipeText('   short   ')).rejects.toThrow(RecipeParseError)
  })

  it('returns parsed recipe with confidence on successful AI extraction', async () => {
    const mockExtraction = {
      name: 'Chicken Stir Fry',
      description: 'A quick weeknight dinner',
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
      ],
    }

    mockGenerateObject.mockResolvedValue({
      object: mockExtraction,
    } as never)

    const result = await parseRecipeText(
      'A full recipe with chicken breast and vegetables for dinner',
    )
    expect(result.extraction.name).toBe('Chicken Stir Fry')
    expect(result.extraction.ingredients).toHaveLength(1)
    expect(result.extraction.servings).toBe(4)
    expect(result.confidence.tier).toBe('high')
  })

  it('throws RecipeParseError when name is empty', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        name: '',
        description: null,
        preparationNotes: null,
        timeMinutes: null,
        servings: 4,
        mealTypes: ['dinner'],
        kidFriendly: false,
        recipeConfidence: 80,
        ingredients: [
          {
            name: 'chicken',
            quantity: 500,
            unit: 'g',
            originalText: '500g chicken',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      },
    } as never)

    await expect(parseRecipeText('Some recipe text that is long enough')).rejects.toThrow(
      RecipeParseError,
    )
  })

  it('throws RecipeParseError when ingredients are empty', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        name: 'Test Recipe',
        description: null,
        preparationNotes: null,
        timeMinutes: null,
        servings: 4,
        mealTypes: ['dinner'],
        kidFriendly: false,
        recipeConfidence: 80,
        ingredients: [],
      },
    } as never)

    await expect(parseRecipeText('Some recipe text that is long enough')).rejects.toThrow(
      RecipeParseError,
    )
  })

  it('throws RecipeParseError when all ingredients are invalid', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        name: 'Test Recipe',
        description: null,
        preparationNotes: null,
        timeMinutes: null,
        servings: 4,
        mealTypes: ['dinner'],
        kidFriendly: false,
        recipeConfidence: 80,
        ingredients: [
          {
            name: 'unknown',
            quantity: 100,
            unit: 'g',
            originalText: 'unknown',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      },
    } as never)

    await expect(parseRecipeText('Some recipe text that is long enough')).rejects.toThrow(
      "Couldn't identify specific ingredients",
    )
  })

  it('throws RecipeParseError when ingredients contain <unknown> placeholder', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        name: 'Test Recipe',
        description: null,
        preparationNotes: null,
        timeMinutes: null,
        servings: 4,
        mealTypes: ['dinner'],
        kidFriendly: false,
        recipeConfidence: 80,
        ingredients: [
          {
            name: '<unknown>',
            quantity: 100,
            unit: 'g',
            originalText: 'mystery ingredient',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
          {
            name: 'chicken breast',
            quantity: 500,
            unit: 'g',
            originalText: '500g chicken breast',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      },
    } as never)

    await expect(parseRecipeText('Some recipe text that is long enough')).rejects.toThrow(
      "Couldn't identify specific ingredients",
    )
  })

  it('throws RecipeParseError for low confidence extraction', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        name: 'Some Article',
        description: null,
        preparationNotes: null,
        timeMinutes: null,
        servings: 4,
        mealTypes: ['dinner'],
        kidFriendly: false,
        recipeConfidence: 15,
        ingredients: [
          {
            name: 'tomato',
            quantity: 1,
            unit: 'piece',
            originalText: '1 tomato',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      },
    } as never)

    await expect(parseRecipeText('Some article about food that is long enough')).rejects.toThrow(
      "doesn't appear to contain a recipe",
    )
  })

  it('returns medium confidence for borderline extraction', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        name: 'Quick Pasta',
        description: null,
        preparationNotes: null,
        timeMinutes: null,
        servings: 4,
        mealTypes: ['dinner'],
        kidFriendly: true,
        recipeConfidence: 50,
        ingredients: [
          {
            name: 'pasta',
            quantity: 400,
            unit: 'g',
            originalText: '400g pasta',
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
        ],
      },
    } as never)

    const result = await parseRecipeText('A casual food blog with some pasta tips for you')
    expect(result.confidence.tier).toBe('medium')
    expect(result.confidence.message).toBeDefined()
  })

  it('wraps non-RecipeParseError exceptions', async () => {
    mockGenerateObject.mockRejectedValue(new Error('AI service unavailable'))

    await expect(parseRecipeText('Some recipe text that is long enough')).rejects.toThrow(
      'Failed to parse the recipe',
    )
  })

  it('logs a parse-recipe AI sample with input preview and full extraction when locale is non-default', async () => {
    const extraction = {
      name: 'Kana riisiga',
      description: null,
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
          originalText: '500g kanafilee',
          isVague: false,
          vaguePhrase: null,
          isDried: null,
        },
      ],
    }
    mockGenerateObject.mockResolvedValue({ object: extraction } as never)

    const longInput = 'Eesti kana ja riis retsept '.repeat(60)
    await parseRecipeText(longInput, 'et')

    expect(mockLogAiSample).toHaveBeenCalledTimes(1)
    const args = mockLogAiSample.mock.calls[0]![0]
    expect(args.callSite).toBe('parse-recipe')
    expect(args.locale).toBe('et')
    expect(args.input).toEqual({
      textPreview: longInput.trim().slice(0, 1000),
      textLength: longInput.trim().length,
    })
    expect(args.output).toEqual(extraction)
  })
})

describe('matchIngredients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeExtracted = (overrides: Partial<ExtractedIngredient> = {}): ExtractedIngredient => ({
    name: 'chicken breast',
    quantity: 500,
    unit: 'g',
    originalText: '500g chicken breast',
    isVague: false,
    vaguePhrase: null,
    isDried: null,
    ...overrides,
  })

  const makeDbMatch = (overrides: Record<string, unknown> = {}) => ({
    id: 'ing-1',
    name: 'chicken breast',
    category: 'protein' as const,
    subcategory: null,
    defaultUnit: 'g' as const,
    gramsPerPiece: null,
    similarity: 0.9,
    ...overrides,
  })

  it('returns matched ingredient with high confidence', async () => {
    mockQueryRaw.mockResolvedValue([makeDbMatch()])

    const results = await matchIngredients([makeExtracted()], 4)

    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('matched')
    const matched = results[0] as {
      type: 'matched'
      ingredient: { name: string }
      convertedQuantity: number
      similarityScore: number
      lowConfidence: boolean
    }
    expect(matched.ingredient.name).toBe('chicken breast')
    expect(matched.convertedQuantity).toBe(500)
    expect(matched.similarityScore).toBe(0.9)
    expect(matched.lowConfidence).toBe(false)
  })

  it('returns unmatched ingredient when no DB results', async () => {
    mockQueryRaw.mockResolvedValue([])

    const results = await matchIngredients([makeExtracted({ name: 'mystery spice' })], 4)

    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('unmatched')
    expect(results[0]!.extractedName).toBe('mystery spice')
  })

  it('still matches when DB returns a translation-sourced row first', async () => {
    // Simulates the matcher receiving a row that came from `ingredient_translation`
    // (e.g., user typed "sibul" and DB returned the canonical English "onion" via the
    // translation JOIN). Caller must accept it the same way as a global-pool match.
    mockQueryRaw.mockResolvedValue([
      makeDbMatch({
        id: 'ing-onion',
        name: 'onion',
        category: 'vegetable',
        defaultUnit: 'piece',
        gramsPerPiece: 110,
        similarity: 0.95,
        source: 'translation',
      }),
    ])

    const results = await matchIngredients(
      [makeExtracted({ name: 'sibul', quantity: 2, unit: 'piece' })],
      4,
      { householdId: 'hh-1', locale: 'et' },
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('matched')
    const matched = results[0] as { type: 'matched'; ingredient: { name: string } }
    // Returns the canonical English name; UI translates for display via @/lib/i18n/content.
    expect(matched.ingredient.name).toBe('onion')
  })

  it('runs the search query when householdId and locale are provided', async () => {
    // Verifies the new options pass-through doesn't break the search loop. The
    // matcher tries multiple candidate names (direct, alias, normalized), so
    // the mock is hit at least once.
    mockQueryRaw.mockResolvedValue([])

    await matchIngredients([makeExtracted({ name: 'mystery spice' })], 4, {
      householdId: 'hh-1',
      locale: 'et',
    })

    expect(mockQueryRaw).toHaveBeenCalled()
  })

  it('marks low confidence matches with alternatives', async () => {
    const lowConfidenceMatches = [
      makeDbMatch({ similarity: 0.55, name: 'chicken breast' }),
      makeDbMatch({ id: 'ing-2', similarity: 0.52, name: 'chicken thigh' }),
      makeDbMatch({ id: 'ing-3', similarity: 0.51, name: 'chicken wing' }),
    ]
    mockQueryRaw.mockResolvedValue(lowConfidenceMatches)

    const results = await matchIngredients([makeExtracted()], 4)

    expect(results).toHaveLength(1)
    const matched = results[0] as {
      type: 'matched'
      lowConfidence: boolean
      alternatives: unknown[]
    }
    expect(matched.type).toBe('matched')
    expect(matched.lowConfidence).toBe(true)
    expect(matched.alternatives).toHaveLength(3)
  })

  it('treats very low confidence matches as unmatched', async () => {
    // Similarity below VERY_LOW_CONFIDENCE_THRESHOLD (0.55) — too unreliable to suggest
    mockQueryRaw.mockResolvedValue([makeDbMatch({ similarity: 0.47, name: 'italian seasoning' })])

    const results = await matchIngredients(
      [makeExtracted({ name: 'fajita seasoning', originalText: 'fajita seasoning' })],
      4,
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('unmatched')
    expect(results[0]!.extractedName).toBe('fajita seasoning')
  })

  it('shows verify match for similarity between very-low and low thresholds', async () => {
    // Similarity between VERY_LOW_CONFIDENCE_THRESHOLD (0.55) and LOW_CONFIDENCE_THRESHOLD (0.6)
    mockQueryRaw.mockResolvedValue([makeDbMatch({ similarity: 0.55, name: 'corn meal' })])

    const results = await matchIngredients(
      [makeExtracted({ name: 'cornmeal', originalText: '1 cup cornmeal' })],
      4,
    )

    expect(results).toHaveLength(1)
    const matched = results[0] as {
      type: 'matched'
      lowConfidence: boolean
      similarityScore: number
    }
    expect(matched.type).toBe('matched')
    expect(matched.lowConfidence).toBe(true)
    expect(matched.similarityScore).toBe(0.55)
  })

  it('does not let last-word fallback override semantic match with different species', async () => {
    // Semantic search for "trout fillet" finds "cod fillet" at 0.72 (above SIMILARITY_THRESHOLD 0.45)
    // Last-word "fillet" would find "cod fillet" at 0.80, but should NOT run
    // because semantic search already found a match above threshold.
    // Additionally, noun mismatch (trout ≠ cod) should force low-confidence.
    mockQueryRaw.mockResolvedValue([makeDbMatch({ name: 'cod fillet', similarity: 0.72 })])

    const results = await matchIngredients(
      [makeExtracted({ name: 'trout fillet', originalText: '200g trout fillet' })],
      4,
    )

    expect(results).toHaveLength(1)
    const matched = results[0] as {
      type: 'matched'
      lowConfidence: boolean
      similarityScore: number
      ingredient: { name: string }
    }
    expect(matched.type).toBe('matched')
    expect(matched.ingredient.name).toBe('cod fillet')
    // Should be flagged as low-confidence due to noun mismatch (trout ≠ cod)
    expect(matched.lowConfidence).toBe(true)
  })

  it('still uses last-word fallback when no semantic match found', async () => {
    // Semantic search for "black bread" returns nothing above threshold
    // Last-word "bread" returns "bread" at 0.90 — should match high-confidence
    mockQueryRaw
      .mockResolvedValueOnce([]) // "black bread" semantic search → no results
      .mockResolvedValueOnce([makeDbMatch({ name: 'bread', similarity: 0.9 })]) // "bread" fallback

    const results = await matchIngredients(
      [makeExtracted({ name: 'black bread', originalText: '200g black bread' })],
      4,
    )

    expect(results).toHaveLength(1)
    const matched = results[0] as {
      type: 'matched'
      lowConfidence: boolean
      similarityScore: number
      ingredient: { name: string }
    }
    expect(matched.type).toBe('matched')
    expect(matched.ingredient.name).toBe('bread')
    expect(matched.similarityScore).toBe(0.9)
    expect(matched.lowConfidence).toBe(false)
  })

  it('rejects last-word fallback when matched name does not contain the last word', async () => {
    // "calabresa sausage" — semantic search finds nothing good
    // Last-word "sausage" would trigram-match "sage" at 0.65, but "sage" does NOT
    // contain the word "sausage" — fallback should be rejected.
    mockQueryRaw
      .mockResolvedValueOnce([]) // "calabresa sausage" semantic search → no results
      .mockResolvedValueOnce([makeDbMatch({ name: 'sage', similarity: 0.65 })]) // "sausage" fallback → "sage"

    const results = await matchIngredients(
      [makeExtracted({ name: 'calabresa sausage', originalText: '200g calabresa sausage' })],
      4,
    )

    expect(results).toHaveLength(1)
    // Should be unmatched because "sage" doesn't contain the word "sausage"
    expect(results[0]!.type).toBe('unmatched')
  })

  it('flags low-confidence when primary noun differs despite high trigram score', async () => {
    // "chicken breast" matched to "turkey breast" — high trigram but different protein
    // "chicken" not in "turkey breast" AND "turkey" not in "chicken breast"
    // → force lowConfidence = true
    mockQueryRaw.mockResolvedValue([makeDbMatch({ name: 'turkey breast', similarity: 0.75 })])

    const results = await matchIngredients(
      [makeExtracted({ name: 'chicken breast', originalText: '400g chicken breast' })],
      4,
    )

    expect(results).toHaveLength(1)
    const matched = results[0] as {
      type: 'matched'
      lowConfidence: boolean
      similarityScore: number
    }
    expect(matched.type).toBe('matched')
    // 0.75 ≥ 0.6 would normally be high-confidence, but noun mismatch forces low
    expect(matched.lowConfidence).toBe(true)
  })

  it('does not flag low-confidence when primary noun matches with different cut', async () => {
    // "chicken breast" matched to "chicken thigh" — same protein, different cut
    // "chicken" is shared, "breast" and "thigh" are both common suffixes
    // → should NOT force low-confidence (normal threshold rules apply)
    mockQueryRaw.mockResolvedValue([makeDbMatch({ name: 'chicken thigh', similarity: 0.75 })])

    const results = await matchIngredients(
      [makeExtracted({ name: 'chicken breast', originalText: '400g chicken breast' })],
      4,
    )

    expect(results).toHaveLength(1)
    const matched = results[0] as {
      type: 'matched'
      lowConfidence: boolean
      similarityScore: number
    }
    expect(matched.type).toBe('matched')
    // 0.75 ≥ 0.6 and primary noun matches → should be high-confidence
    expect(matched.lowConfidence).toBe(false)
  })

  it('handles vague quantities with known phrase', async () => {
    mockQueryRaw.mockResolvedValue([
      makeDbMatch({ category: 'spice', subcategory: 'mineral', name: 'salt' }),
    ])

    const results = await matchIngredients(
      [
        makeExtracted({
          name: 'salt',
          quantity: null,
          unit: null,
          isVague: true,
          vaguePhrase: 'to taste',
          originalText: 'salt to taste',
        }),
      ],
      4,
    )

    expect(results).toHaveLength(1)
    const matched = results[0] as {
      type: 'matched'
      isVague: boolean
      originalPhrase: string
      convertedQuantity: number
    }
    expect(matched.type).toBe('matched')
    expect(matched.isVague).toBe(true)
    expect(matched.originalPhrase).toBe('to taste')
    // Vague quantity should be > 0 (per-serving * servings)
    expect(matched.convertedQuantity).toBeGreaterThan(0)
  })

  it('falls back to 10g per serving for vague with no rule match', async () => {
    mockQueryRaw.mockResolvedValue([makeDbMatch()])

    const results = await matchIngredients(
      [
        makeExtracted({
          name: 'chicken',
          quantity: null,
          unit: null,
          isVague: true,
          vaguePhrase: 'unrecognized phrase',
          originalText: 'chicken, unrecognized phrase',
        }),
      ],
      4,
    )

    const matched = results[0] as { type: 'matched'; convertedQuantity: number }
    expect(matched.type).toBe('matched')
    // Fallback: 10g * 4 servings = 40
    expect(matched.convertedQuantity).toBe(40)
  })

  it('handles null quantity and unit as vague fallback', async () => {
    mockQueryRaw.mockResolvedValue([makeDbMatch()])

    const results = await matchIngredients(
      [
        makeExtracted({
          quantity: null,
          unit: null,
          isVague: false,
          vaguePhrase: null,
        }),
      ],
      4,
    )

    const matched = results[0] as {
      type: 'matched'
      isVague: boolean
      originalPhrase: string
      convertedQuantity: number
    }
    expect(matched.type).toBe('matched')
    // Falls into the else branch: 10 * servings
    expect(matched.isVague).toBe(true)
    expect(matched.originalPhrase).toBe('some')
    expect(matched.convertedQuantity).toBe(40)
  })

  it('adds quantity warning for unreasonable quantities', async () => {
    mockQueryRaw.mockResolvedValue([makeDbMatch()])

    const results = await matchIngredients([makeExtracted({ quantity: 10000, unit: 'g' })], 4)

    const matched = results[0] as { type: 'matched'; quantityWarning: string }
    expect(matched.type).toBe('matched')
    expect(matched.quantityWarning).toContain('Unusually high')
  })

  it('performs unit conversion during matching', async () => {
    mockQueryRaw.mockResolvedValue([makeDbMatch({ defaultUnit: 'g' })])

    const results = await matchIngredients([makeExtracted({ quantity: 2, unit: 'tbsp' })], 4)

    const matched = results[0] as { type: 'matched'; convertedQuantity: number }
    expect(matched.type).toBe('matched')
    // 2 tbsp = 30g
    expect(matched.convertedQuantity).toBe(30)
  })

  it('tries alias expansion for better matches', async () => {
    // First call (direct search for "pepper") returns low similarity
    // Second call (alias search for "black pepper") returns higher
    mockQueryRaw
      .mockResolvedValueOnce([makeDbMatch({ similarity: 0.4, name: 'red bell pepper' })])
      .mockResolvedValueOnce([makeDbMatch({ similarity: 0.95, name: 'black pepper' })])

    const results = await matchIngredients(
      [makeExtracted({ name: 'pepper', quantity: 5, unit: 'g' })],
      4,
    )

    const matched = results[0] as {
      type: 'matched'
      ingredient: { name: string }
      similarityScore: number
    }
    expect(matched.type).toBe('matched')
    // Should use the alias match (black pepper) because it has higher similarity
    expect(matched.ingredient.name).toBe('black pepper')
    expect(matched.similarityScore).toBe(0.95)
  })

  it('keeps direct match when alias does not improve', async () => {
    // Direct search returns good match
    // Alias search returns worse match
    mockQueryRaw
      .mockResolvedValueOnce([makeDbMatch({ similarity: 0.9, name: 'olive oil' })])
      .mockResolvedValueOnce([makeDbMatch({ similarity: 0.5, name: 'vegetable oil' })])

    const results = await matchIngredients(
      [makeExtracted({ name: 'oil', quantity: 15, unit: 'ml' })],
      4,
    )

    const matched = results[0] as { type: 'matched'; ingredient: { name: string } }
    expect(matched.type).toBe('matched')
    expect(matched.ingredient.name).toBe('olive oil')
  })

  it('processes multiple ingredients', async () => {
    // "chicken breast" → semantic match at 0.9 → skip last-word fallback
    // "zxywvut spice" → no semantic match → last-word "spice" fallback → no match
    mockQueryRaw
      .mockResolvedValueOnce([makeDbMatch({ name: 'chicken breast' })]) // "chicken breast" semantic
      .mockResolvedValueOnce([]) // "zxywvut spice" semantic — no match
      .mockResolvedValueOnce([]) // "spice" (last word fallback) — no match

    const results = await matchIngredients(
      [
        makeExtracted({ name: 'chicken breast' }),
        makeExtracted({
          name: 'zxywvut spice',
          quantity: 10,
          unit: 'g',
          originalText: '10g zxywvut spice',
        }),
      ],
      4,
    )

    expect(results).toHaveLength(2)
    expect(results[0]!.type).toBe('matched')
    expect(results[1]!.type).toBe('unmatched')
  })

  it('adds guardrail warning for category-specific thresholds', async () => {
    // Spice with 5g per serving (threshold is 2g for spice)
    mockQueryRaw.mockResolvedValue([
      makeDbMatch({ category: 'spice', subcategory: 'spice', name: 'paprika', defaultUnit: 'g' }),
    ])

    const results = await matchIngredients(
      [makeExtracted({ name: 'paprika', quantity: 20, unit: 'g', originalText: '20g paprika' })],
      4,
    )

    const matched = results[0] as { type: 'matched'; quantityWarning: string }
    expect(matched.type).toBe('matched')
    // 20g / 4 servings = 5g per serving, exceeds 2g spice threshold
    expect(matched.quantityWarning).toContain('Unusually high')
  })

  it('treats "red chili pepper" → "red bell pepper" as unmatched when similarity is below VERY_LOW_CONFIDENCE_THRESHOLD', async () => {
    // Simulate fuzzy search returning "red bell pepper" with similarity 0.53
    // This is above the old threshold (0.5) but should be below the new one
    mockQueryRaw.mockResolvedValue([
      makeDbMatch({
        name: 'red bell pepper',
        similarity: 0.53,
        category: 'vegetable',
        subcategory: 'fruit-vegetable',
      }),
    ])

    const results = await matchIngredients(
      [makeExtracted({ name: 'red chili pepper', quantity: 50, unit: 'g' })],
      4,
    )

    // Should be treated as unmatched because similarity is too low for a reliable suggestion
    expect(results[0]!.type).toBe('unmatched')
    expect((results[0] as { extractedName: string }).extractedName).toBe('red chili pepper')
  })

  it('matches "eggs" to "egg" via normalization fallback', async () => {
    // Candidate order: "eggs" (direct), "egg" (normalized/singularized)
    mockQueryRaw
      .mockResolvedValueOnce([makeDbMatch({ name: 'egg', similarity: 0.5, category: 'protein' })]) // "eggs"
      .mockResolvedValueOnce([makeDbMatch({ name: 'egg', similarity: 0.95, category: 'protein' })]) // "egg"

    const results = await matchIngredients(
      [makeExtracted({ name: 'eggs', quantity: 3, unit: 'piece' })],
      4,
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('matched')
    const matched = results[0] as {
      type: 'matched'
      ingredient: { name: string }
      similarityScore: number
    }
    expect(matched.ingredient.name).toBe('egg')
    expect(matched.similarityScore).toBe(0.95)
  })

  it('matches "fresh chives" to "chives" via modifier stripping', async () => {
    // Candidate order: "fresh chives" (direct), "chives" (normalized — modifier stripped)
    mockQueryRaw
      .mockResolvedValueOnce([
        makeDbMatch({ name: 'chives', similarity: 0.45, category: 'vegetable' }),
      ]) // "fresh chives"
      .mockResolvedValueOnce([
        makeDbMatch({ name: 'chives', similarity: 0.95, category: 'vegetable' }),
      ]) // "chives"

    const results = await matchIngredients(
      [makeExtracted({ name: 'fresh chives', quantity: 10, unit: 'g' })],
      4,
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('matched')
    const matched = results[0] as {
      type: 'matched'
      ingredient: { name: string }
      similarityScore: number
    }
    expect(matched.ingredient.name).toBe('chives')
    expect(matched.similarityScore).toBe(0.95)
  })

  it('matches "black bread" to "bread" via last-word fallback', async () => {
    // Candidate order: "black bread" (direct + normalized, same), "bread" (last word)
    mockQueryRaw
      .mockResolvedValueOnce([makeDbMatch({ name: 'bread', similarity: 0.48, category: 'grain' })]) // "black bread"
      .mockResolvedValueOnce([makeDbMatch({ name: 'bread', similarity: 0.9, category: 'grain' })]) // "bread"

    const results = await matchIngredients(
      [makeExtracted({ name: 'black bread', quantity: 200, unit: 'g' })],
      4,
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('matched')
    const matched = results[0] as {
      type: 'matched'
      ingredient: { name: string }
      similarityScore: number
    }
    expect(matched.ingredient.name).toBe('bread')
    expect(matched.similarityScore).toBe(0.9)
  })

  it('keeps best match when direct name scores higher than fallbacks', async () => {
    // Direct "chicken breast" already scores high — normalization shouldn't downgrade
    mockQueryRaw.mockResolvedValue([makeDbMatch({ similarity: 0.95 })])

    const results = await matchIngredients([makeExtracted()], 4)

    expect(results).toHaveLength(1)
    expect(results[0]!.type).toBe('matched')
    const matched = results[0] as { type: 'matched'; similarityScore: number }
    expect(matched.similarityScore).toBe(0.95)
  })
})

describe('mergeDuplicateIngredients', () => {
  const makeMatched = (overrides: Partial<MatchedIngredient> = {}): MatchedIngredient => ({
    type: 'matched',
    extractedName: 'olive oil',
    extractedQuantity: 30,
    extractedUnit: 'ml',
    originalText: '2 tbsp olive oil',
    ingredient: {
      id: 'ing-olive-oil',
      name: 'olive oil',
      category: 'fat',
      subcategory: 'oil',
      defaultUnit: 'g',
      gramsPerPiece: null,
      calories: 884,
      protein: 0,
      carbs: 0,
      fat: 100,
    },
    convertedQuantity: 27,
    isVague: false,
    similarityScore: 0.95,
    lowConfidence: false,
    ...overrides,
  })

  const makeUnmatched = (overrides: Partial<UnmatchedIngredient> = {}): UnmatchedIngredient => ({
    type: 'unmatched',
    extractedName: "za'atar",
    extractedQuantity: 5,
    extractedUnit: 'g',
    originalText: "1 tsp za'atar",
    isVague: false,
    ...overrides,
  })

  it('sums quantities when merging two matched ingredients with same id', () => {
    const results: IngredientMatchResult[] = [
      makeMatched({ convertedQuantity: 27, originalText: '2 tbsp olive oil (dough)' }),
      makeMatched({ convertedQuantity: 14, originalText: '1 tbsp olive oil (topping)' }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(1)
    expect(merged[0]!.type).toBe('matched')
    const m = merged[0] as MatchedIngredient
    expect(m.convertedQuantity).toBe(41)
    expect(m.originalText).toBe('2 tbsp olive oil (dough) + 1 tbsp olive oil (topping)')
  })

  it('marks merged row as vague when either row is vague', () => {
    const results: IngredientMatchResult[] = [
      makeMatched({ convertedQuantity: 27, originalText: '2 tbsp olive oil', isVague: false }),
      makeMatched({
        convertedQuantity: 0,
        originalText: 'olive oil to taste',
        isVague: true,
        originalPhrase: 'to taste',
      }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(1)
    const m = merged[0] as MatchedIngredient
    expect(m.isVague).toBe(true)
    expect(m.convertedQuantity).toBe(0)
    expect(m.originalPhrase).toBe('to taste')
  })

  it('marks merged row as vague when both rows are vague', () => {
    const results: IngredientMatchResult[] = [
      makeMatched({
        convertedQuantity: 0,
        isVague: true,
        originalPhrase: 'a drizzle',
        originalText: 'a drizzle of olive oil',
      }),
      makeMatched({
        convertedQuantity: 0,
        isVague: true,
        originalPhrase: 'to taste',
        originalText: 'olive oil to taste',
      }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(1)
    const m = merged[0] as MatchedIngredient
    expect(m.isVague).toBe(true)
    expect(m.convertedQuantity).toBe(0)
    expect(m.originalPhrase).toBe('a drizzle')
  })

  it('does not merge unmatched ingredients', () => {
    const results: IngredientMatchResult[] = [
      makeUnmatched({ extractedName: "za'atar", originalText: "1 tsp za'atar" }),
      makeUnmatched({ extractedName: "za'atar", originalText: "2 tsp za'atar" }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(2)
    expect(merged[0]!.type).toBe('unmatched')
    expect(merged[1]!.type).toBe('unmatched')
  })

  it('does not merge different matched ingredients', () => {
    const results: IngredientMatchResult[] = [
      makeMatched({ ingredient: { ...makeMatched().ingredient, id: 'ing-olive-oil' } }),
      makeMatched({
        ingredient: {
          id: 'ing-mozzarella',
          name: 'mozzarella',
          category: 'dairy',
          subcategory: null,
          defaultUnit: 'g',
          gramsPerPiece: null,
          calories: 280,
          protein: 28,
          carbs: 3,
          fat: 17,
        },
        extractedName: 'mozzarella',
        convertedQuantity: 200,
        originalText: '200g mozzarella',
      }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(2)
  })

  it('preserves original order with unmatched items interleaved', () => {
    const results: IngredientMatchResult[] = [
      makeMatched({ originalText: 'olive oil (dough)', convertedQuantity: 27 }),
      makeUnmatched({ originalText: "1 tsp za'atar" }),
      makeMatched({ originalText: 'olive oil (topping)', convertedQuantity: 14 }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(2)
    expect(merged[0]!.type).toBe('matched')
    expect((merged[0] as MatchedIngredient).convertedQuantity).toBe(41)
    expect(merged[1]!.type).toBe('unmatched')
  })

  it('re-runs guardrails on summed quantity', () => {
    // 27g + 14g = 41g olive oil for 4 servings = 10.25g/serving
    // Oil guardrail is 30g/serving, so this should pass
    const results: IngredientMatchResult[] = [
      makeMatched({
        convertedQuantity: 27,
        quantityWarning: 'Some old warning',
        originalText: '2 tbsp olive oil',
      }),
      makeMatched({ convertedQuantity: 14, originalText: '1 tbsp olive oil' }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(1)
    const m = merged[0] as MatchedIngredient
    expect(m.convertedQuantity).toBe(41)
    expect(m.quantityWarning).toBeUndefined()
  })

  it('generates warning when summed quantity exceeds guardrail', () => {
    // 100g + 100g = 200g olive oil for 4 servings = 50g/serving
    // Oil guardrail is 30g/serving, so this should trigger a warning
    const results: IngredientMatchResult[] = [
      makeMatched({ convertedQuantity: 100, originalText: '100g olive oil (dough)' }),
      makeMatched({ convertedQuantity: 100, originalText: '100g olive oil (topping)' }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(1)
    const m = merged[0] as MatchedIngredient
    expect(m.convertedQuantity).toBe(200)
    expect(m.quantityWarning).toContain('Unusually high')
  })

  it('passes through single items unchanged', () => {
    const results: IngredientMatchResult[] = [makeMatched(), makeUnmatched()]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual(makeMatched())
    expect(merged[1]).toEqual(makeUnmatched())
  })
})

describe('parseAndMatchRecipe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses text and matches ingredients end-to-end', async () => {
    const mockExtraction = {
      name: 'Simple Pasta',
      description: 'Easy weeknight pasta',
      preparationNotes: null,
      timeMinutes: 20,
      servings: 4,
      mealTypes: ['dinner'],
      kidFriendly: true,
      recipeConfidence: 95,
      ingredients: [
        {
          name: 'spaghetti',
          quantity: 400,
          unit: 'g',
          originalText: '400g spaghetti',
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
      ],
    }

    mockGenerateObject.mockResolvedValue({ object: mockExtraction } as never)
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          id: 'ing-1',
          name: 'spaghetti',
          category: 'carb',
          subcategory: null,
          defaultUnit: 'g',
          gramsPerPiece: null,
          similarity: 0.95,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'ing-2',
          name: 'olive oil',
          category: 'fat',
          subcategory: 'oil',
          defaultUnit: 'g',
          gramsPerPiece: null,
          similarity: 0.98,
        },
      ])

    const result = await parseAndMatchRecipe(
      'Simple pasta recipe: 400g spaghetti, 2 tbsp olive oil',
    )

    expect(result.name).toBe('Simple Pasta')
    expect(result.description).toBe('Easy weeknight pasta')
    expect(result.timeMinutes).toBe(20)
    expect(result.servings).toBe(4)
    expect(result.mealTypes).toEqual(['dinner'])
    expect(result.kidFriendly).toBe(true)
    expect(result.ingredients).toHaveLength(2)
    expect(result.allMatched).toBe(true)
    expect(result.confidenceTier).toBe('high')
  })

  it('sets allMatched to false when some ingredients are unmatched', async () => {
    const mockExtraction = {
      name: 'Mystery Dish',
      description: null,
      preparationNotes: null,
      timeMinutes: null,
      servings: 2,
      mealTypes: ['dinner'],
      kidFriendly: false,
      recipeConfidence: 85,
      ingredients: [
        {
          name: 'chicken breast',
          quantity: 300,
          unit: 'g',
          originalText: '300g chicken breast',
          isVague: false,
          vaguePhrase: null,
          isDried: null,
        },
        {
          name: 'zarkleberry',
          quantity: 50,
          unit: 'g',
          originalText: '50g zarkleberry',
          isVague: false,
          vaguePhrase: null,
          isDried: null,
        },
      ],
    }

    mockGenerateObject.mockResolvedValue({ object: mockExtraction } as never)
    // "chicken breast" → candidates: "chicken breast", "breast" (last word)
    // "zarkleberry" → candidates: "zarkleberry" (single word, no fallbacks)
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          id: 'ing-1',
          name: 'chicken breast',
          category: 'protein',
          subcategory: null,
          defaultUnit: 'g',
          gramsPerPiece: null,
          similarity: 0.95,
        },
      ])
      .mockResolvedValueOnce([]) // "breast" (last word fallback)
      .mockResolvedValueOnce([]) // zarkleberry not found

    const result = await parseAndMatchRecipe('Mystery dish: 300g chicken breast, 50g zarkleberry')

    expect(result.allMatched).toBe(false)
    expect(result.ingredients[0]!.type).toBe('matched')
    expect(result.ingredients[1]!.type).toBe('unmatched')
  })

  it('threads household locale into the parser prompt and matcher options (pasted Estonian text sample)', async () => {
    // Sample: Estonian pasted-text recipe. AI is mocked — we assert the *inputs*
    // (prompt + matcher options) carry locale='et', not any live AI behavior.
    const mockExtraction = {
      name: 'Kanasupp',
      description: 'Kiire kanasupp pere õhtusöögiks',
      preparationNotes: null,
      timeMinutes: 25,
      servings: 4,
      mealTypes: ['dinner'],
      kidFriendly: true,
      recipeConfidence: 92,
      ingredients: [
        {
          name: 'kana',
          quantity: 400,
          unit: 'g',
          originalText: '400g kana',
          isVague: false,
          vaguePhrase: null,
          isDried: null,
        },
      ],
    }

    mockGenerateObject.mockResolvedValue({ object: mockExtraction } as never)
    mockQueryRaw.mockResolvedValueOnce([
      {
        id: 'ing-1',
        name: 'chicken',
        category: 'protein',
        subcategory: null,
        defaultUnit: 'g',
        gramsPerPiece: null,
        similarity: 0.85,
        source: 'translation',
      },
    ])

    const pastedText =
      'Kanasupp: 400g kana, 2 porgandit, 1 sibul, keeda pehmeks ja maitsesta soolaga.'

    const result = await parseAndMatchRecipe(pastedText, undefined, undefined, {
      householdId: 'household-et',
      locale: 'et',
    })

    // Prompt includes the recipe text and the Estonian locale instruction.
    const call = mockGenerateObject.mock.calls[0]![0]! as { prompt: string }
    expect(call.prompt).toContain(pastedText.slice(0, 20))
    expect(call.prompt).toContain('LOCALE:')
    expect(call.prompt).toContain('Estonian')

    // Matcher was called with the household + locale so it can also search
    // translations. The raw-SQL string contains '$3' for the locale parameter.
    expect(mockQueryRaw).toHaveBeenCalled()
    const queryArgs = mockQueryRaw.mock.calls[0]! as unknown as [unknown, ...unknown[]]
    // Template literal values (searchName, householdIdParam, localeParam) arrive as positional args.
    // Validate the locale param is 'et' by finding it in the args (position may vary across queries).
    expect(queryArgs.slice(1)).toContain('et')

    expect(result.name).toBe('Kanasupp')
  })

  it('threads household locale when the input is a URL (Estonian URL sample)', async () => {
    // This test covers the route-level URL path at the library level: we feed
    // Estonian-origin recipe text that a URL fetch might return, and assert the
    // locale threading reaches both the AI prompt and the matcher.
    const mockExtraction = {
      name: 'Kartulisalat',
      description: null,
      preparationNotes: null,
      timeMinutes: 30,
      servings: 6,
      mealTypes: ['lunch'],
      kidFriendly: true,
      recipeConfidence: 88,
      ingredients: [
        {
          name: 'kartul',
          quantity: 1000,
          unit: 'g',
          originalText: '1kg kartulit',
          isVague: false,
          vaguePhrase: null,
          isDried: null,
        },
      ],
    }

    mockGenerateObject.mockResolvedValue({ object: mockExtraction } as never)
    mockQueryRaw.mockResolvedValueOnce([
      {
        id: 'ing-potato',
        name: 'potato',
        category: 'carb',
        subcategory: null,
        defaultUnit: 'g',
        gramsPerPiece: null,
        similarity: 0.82,
        source: 'translation',
      },
    ])

    // Text shape that mirrors what fetchRecipeFromUrl would produce after
    // stripping an Estonian-language recipe page.
    const fetchedEtText =
      'Kartulisalat: 1kg kartulit, 3 muna, 1 sibul, 200g hapukoort. Keeda kartulid ja munad, haki sibul.'
    const sourceUrl = 'https://www.toidutare.ee/retseptid/kartulisalat'

    const result = await parseAndMatchRecipe(fetchedEtText, sourceUrl, undefined, {
      householdId: 'household-et',
      locale: 'et',
    })

    const call = mockGenerateObject.mock.calls[0]![0]! as { prompt: string }
    expect(call.prompt).toContain('LOCALE:')
    expect(call.prompt).toContain('Estonian')

    expect(result.sourceUrl).toBe(sourceUrl)
    expect(result.name).toBe('Kartulisalat')
  })
})

describe('parseAndMatchRecipe source URL prepending', () => {
  const mockRecipeExtraction: RecipeExtraction = {
    name: 'Test Recipe',
    description: 'A test recipe',
    preparationNotes: '1. Heat oven to 200C\n2. Mix ingredients',
    timeMinutes: 30,
    servings: 4,
    mealTypes: ['dinner'],
    kidFriendly: true,
    ingredients: [
      {
        name: 'chicken breast',
        quantity: 400,
        unit: 'g',
        originalText: '400g chicken breast',
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      },
    ],
    recipeConfidence: 95,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock AI extraction
    mockGenerateObject.mockResolvedValue({ object: mockRecipeExtraction } as never)
    // Mock ingredient matching
    mockQueryRaw.mockResolvedValue([
      {
        id: 'ingredient-1',
        name: 'chicken breast',
        category: 'protein',
        subcategory: null,
        defaultUnit: 'g',
        gramsPerPiece: null,
        similarity: 1.0,
      },
    ])
  })

  it('returns sourceUrl separately and keeps preparation notes clean when URL is provided', async () => {
    const result = await parseAndMatchRecipe(
      'This is a longer recipe text with at least 20 characters so it passes validation',
      'https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas',
    )

    expect(result.sourceUrl).toBe('https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
    expect(result.preparationNotes).toBe('1. Heat oven to 200C\n2. Mix ingredients')
  })

  it('returns sourceUrl when preparation notes are null', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { ...mockRecipeExtraction, preparationNotes: null },
    } as never)

    const result = await parseAndMatchRecipe(
      'This is a longer recipe text with at least 20 characters so it passes validation',
      'https://www.example.com/recipe',
    )

    expect(result.sourceUrl).toBe('https://www.example.com/recipe')
    expect(result.preparationNotes).toBeNull()
  })

  it('returns null sourceUrl when no source URL is provided', async () => {
    const result = await parseAndMatchRecipe(
      'This is a longer recipe text with at least 20 characters so it passes validation',
    )

    expect(result.sourceUrl).toBeNull()
    expect(result.preparationNotes).toBe('1. Heat oven to 200C\n2. Mix ingredients')
  })

  it('returns null sourceUrl for plain text imports', async () => {
    const result = await parseAndMatchRecipe(
      'Plain text recipe with enough characters to pass the length validation check',
    )

    expect(result.sourceUrl).toBeNull()
    expect(result.preparationNotes).toBe('1. Heat oven to 200C\n2. Mix ingredients')
  })
})
