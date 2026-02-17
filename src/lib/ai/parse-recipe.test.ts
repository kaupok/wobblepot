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

import { prisma } from '@/lib/prisma'
import { generateObject } from 'ai'
import {
  convertQuantity,
  isReasonableQuantity,
  buildRecipeExtractionPrompt,
  parseRecipeText,
  matchIngredients,
  parseAndMatchRecipe,
  stripHtmlToText,
  extractJsonLdRecipe,
  fetchRecipeFromUrl,
  evaluateRecipeConfidence,
  RecipeParseError,
  RecipeExtractionSchema,
  LOW_CONFIDENCE_THRESHOLD,
  VERY_LOW_CONFIDENCE_THRESHOLD,
  SIMILARITY_THRESHOLD,
  MAX_GRAMS_PER_SERVING,
  DEFAULT_GRAMS_PER_PIECE,
  CUP_CONVERSIONS,
  fuzzySearchIngredient,
} from './parse-recipe'
import type { ExtractedIngredient, RecipeExtraction } from './parse-recipe'

const mockQueryRaw = vi.mocked(prisma.$queryRaw)
const mockGenerateObject = vi.mocked(generateObject)

describe('RecipeParseError', () => {
  it('creates error with correct name and message', () => {
    const error = new RecipeParseError('Test error')
    expect(error.name).toBe('RecipeParseError')
    expect(error.message).toBe('Test error')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('convertQuantity', () => {
  const makeIngredient = (
    defaultUnit: 'g' | 'piece',
    gramsPerPiece: number | null = null,
    category?: string,
  ) => ({
    defaultUnit: defaultUnit as 'g' | 'piece',
    gramsPerPiece,
    category: category as 'spice' | 'dairy' | 'protein' | 'vegetable' | undefined,
  })

  it('returns same quantity when units match', () => {
    expect(convertQuantity(100, 'g', makeIngredient('g'))).toBe(100)
    expect(convertQuantity(3, 'piece', makeIngredient('piece'))).toBe(3)
  })

  it('converts grams to grams (passthrough)', () => {
    expect(convertQuantity(500, 'g', makeIngredient('g'))).toBe(500)
  })

  it('converts ml to grams (1:1 density)', () => {
    expect(convertQuantity(250, 'ml', makeIngredient('g'))).toBe(250)
  })

  it('converts pieces to grams using gramsPerPiece', () => {
    expect(convertQuantity(3, 'piece', makeIngredient('g', 60))).toBe(180)
  })

  it('converts pieces to grams using DEFAULT_GRAMS_PER_PIECE when not specified', () => {
    expect(convertQuantity(3, 'piece', makeIngredient('g', null))).toBe(3 * DEFAULT_GRAMS_PER_PIECE)
  })

  it('converts tbsp to grams (1 tbsp = 15g)', () => {
    expect(convertQuantity(2, 'tbsp', makeIngredient('g'))).toBe(30)
  })

  it('converts tsp to grams (1 tsp = 5g)', () => {
    expect(convertQuantity(3, 'tsp', makeIngredient('g'))).toBe(15)
  })

  it('converts cups to grams using category-specific conversion for spice', () => {
    expect(convertQuantity(1, 'cup', makeIngredient('g', null, 'spice'))).toBe(
      CUP_CONVERSIONS.spice,
    )
  })

  it('converts cups to grams using category-specific conversion for dairy', () => {
    expect(convertQuantity(1, 'cup', makeIngredient('g', null, 'dairy'))).toBe(
      CUP_CONVERSIONS.dairy,
    )
  })

  it('converts cups to grams using default when no category', () => {
    expect(convertQuantity(1, 'cup', makeIngredient('g'))).toBe(CUP_CONVERSIONS.default)
  })

  it('converts oz to grams (1 oz = 28g)', () => {
    expect(convertQuantity(4, 'oz', makeIngredient('g'))).toBe(112)
  })

  it('converts lb to grams (1 lb = 454g)', () => {
    expect(convertQuantity(2, 'lb', makeIngredient('g'))).toBe(908)
  })

  it('converts grams to pieces using gramsPerPiece', () => {
    expect(convertQuantity(180, 'g', makeIngredient('piece', 60))).toBe(3)
  })

  it('converts grams to pieces rounding to 1 decimal', () => {
    // 100g / 60g per piece = 1.666... → 1.7
    expect(convertQuantity(100, 'g', makeIngredient('piece', 60))).toBe(1.7)
  })

  it('returns original quantity for piece conversion without gramsPerPiece', () => {
    expect(convertQuantity(200, 'g', makeIngredient('piece', null))).toBe(200)
  })

  it('handles unknown fromUnit as passthrough', () => {
    expect(convertQuantity(100, 'unknown', makeIngredient('g'))).toBe(100)
  })
})

describe('isReasonableQuantity', () => {
  it('returns true for reasonable quantities', () => {
    // 400g total for 4 servings = 100g per serving
    expect(isReasonableQuantity(400, 4)).toBe(true)
  })

  it('returns true at the boundary', () => {
    // 2000g for 4 servings = 500g per serving (exactly at MAX_GRAMS_PER_SERVING)
    expect(isReasonableQuantity(MAX_GRAMS_PER_SERVING * 4, 4)).toBe(true)
  })

  it('returns false for unreasonable quantities', () => {
    // 4000g for 4 servings = 1000g per serving
    expect(isReasonableQuantity(4000, 4)).toBe(false)
  })

  it('handles single serving', () => {
    expect(isReasonableQuantity(MAX_GRAMS_PER_SERVING, 1)).toBe(true)
    expect(isReasonableQuantity(MAX_GRAMS_PER_SERVING + 1, 1)).toBe(false)
  })
})

describe('buildRecipeExtractionPrompt', () => {
  it('includes the recipe text', () => {
    const prompt = buildRecipeExtractionPrompt('My delicious recipe')
    expect(prompt).toContain('My delicious recipe')
  })

  it('includes vague phrases list', () => {
    const prompt = buildRecipeExtractionPrompt('test')
    expect(prompt).toContain('to taste')
    expect(prompt).toContain('a pinch')
    expect(prompt).toContain('for garnish')
  })

  it('includes unit conversion guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test')
    expect(prompt).toContain('tbsp')
    expect(prompt).toContain('tsp')
    expect(prompt).toContain('cup')
  })

  it('includes ingredient specificity guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test')
    expect(prompt).toContain('black pepper')
    expect(prompt).toContain('olive oil')
  })

  it('includes confidence scoring guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test')
    expect(prompt).toContain('RECIPE CONFIDENCE SCORING')
    expect(prompt).toContain('90-100')
    expect(prompt).toContain('not a recipe')
  })
})

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
})

describe('fuzzySearchIngredient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls prisma.$queryRaw with the search name', async () => {
    mockQueryRaw.mockResolvedValue([])
    await fuzzySearchIngredient('chicken breast')
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('returns results from the database', async () => {
    const mockResults = [
      {
        id: 'ing-1',
        name: 'chicken breast',
        category: 'protein',
        subcategory: null,
        defaultUnit: 'g',
        gramsPerPiece: null,
        similarity: 0.9,
      },
    ]
    mockQueryRaw.mockResolvedValue(mockResults)

    const results = await fuzzySearchIngredient('chicken breast')
    expect(results).toEqual(mockResults)
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
    mockQueryRaw
      .mockResolvedValueOnce([makeDbMatch({ name: 'chicken breast' })])
      .mockResolvedValueOnce([]) // no match for second ingredient

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
      .mockResolvedValueOnce([]) // zarkleberry not found

    const result = await parseAndMatchRecipe('Mystery dish: 300g chicken breast, 50g zarkleberry')

    expect(result.allMatched).toBe(false)
    expect(result.ingredients[0]!.type).toBe('matched')
    expect(result.ingredients[1]!.type).toBe('unmatched')
  })
})

describe('stripHtmlToText', () => {
  it('strips HTML tags', () => {
    expect(stripHtmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('removes script and style blocks', () => {
    const html = '<p>Recipe</p><script>alert("x")</script><style>.a{}</style><p>Ingredients</p>'
    expect(stripHtmlToText(html)).toBe('Recipe Ingredients')
  })

  it('removes nav, header, and footer blocks', () => {
    const html = '<header>Nav bar</header><main>Recipe content</main><footer>Copyright</footer>'
    expect(stripHtmlToText(html)).toBe('Recipe content')
  })

  it('decodes HTML entities', () => {
    expect(stripHtmlToText('&amp; &lt; &gt; &quot; &#039; &apos; &nbsp;')).toBe("& < > \" ' '")
  })

  it('collapses whitespace', () => {
    expect(stripHtmlToText('  hello   world  \n\n  foo  ')).toBe('hello world foo')
  })

  it('handles empty input', () => {
    expect(stripHtmlToText('')).toBe('')
  })
})

describe('extractJsonLdRecipe', () => {
  it('extracts recipe from top-level JSON-LD object', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Classic Beef Stroganoff",
        "description": "A creamy beef dish",
        "prepTime": "PT15M",
        "cookTime": "PT30M",
        "recipeYield": "4 servings",
        "recipeIngredient": [
          "500g beef sirloin",
          "200g mushrooms",
          "1 cup sour cream"
        ],
        "recipeInstructions": [
          {"@type": "HowToStep", "text": "Slice the beef thinly."},
          {"@type": "HowToStep", "text": "Sauté mushrooms until golden."},
          {"@type": "HowToStep", "text": "Combine with sour cream sauce."}
        ]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Classic Beef Stroganoff')
    expect(result).toContain('500g beef sirloin')
    expect(result).toContain('200g mushrooms')
    expect(result).toContain('1 cup sour cream')
    expect(result).toContain('Prep: 15 min')
    expect(result).toContain('Cook: 30 min')
    expect(result).toContain('Servings: 4 servings')
    expect(result).toContain('Slice the beef thinly')
  })

  it('extracts recipe from @graph array', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {"@type": "WebSite", "name": "My Recipes"},
          {
            "@type": "Recipe",
            "name": "Easy Chicken Fajitas",
            "recipeIngredient": ["500g chicken breast", "2 bell peppers"],
            "recipeInstructions": [
              {"@type": "HowToStep", "text": "Slice chicken and peppers."}
            ]
          }
        ]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Easy Chicken Fajitas')
    expect(result).toContain('500g chicken breast')
    expect(result).toContain('2 bell peppers')
  })

  it('handles @type as array (e.g., ["Recipe", "HowTo"])', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": ["Recipe", "HowTo"],
        "name": "Pizza Dough",
        "recipeIngredient": ["500g flour", "7g yeast"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Pizza Dough')
    expect(result).toContain('500g flour')
  })

  it('handles string instructions', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Simple Soup",
        "recipeIngredient": ["1 onion", "2 carrots", "500ml stock"],
        "recipeInstructions": "Chop vegetables. Add to stock. Simmer for 30 minutes."
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Simple Soup')
    expect(result).toContain('Chop vegetables')
  })

  it('handles string array instructions', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Quick Pasta",
        "recipeIngredient": ["400g pasta"],
        "recipeInstructions": ["Boil water.", "Cook pasta 8 min.", "Drain and serve."]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('1. Boil water.')
    expect(result).toContain('2. Cook pasta 8 min.')
    expect(result).toContain('3. Drain and serve.')
  })

  it('returns null when no JSON-LD scripts found', () => {
    const html = '<html><head></head><body><h1>Recipe</h1></body></html>'
    expect(extractJsonLdRecipe(html)).toBeNull()
  })

  it('returns null when JSON-LD has no Recipe type', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": "WebSite", "name": "My Blog"}
      </script>
    </head><body></body></html>`

    expect(extractJsonLdRecipe(html)).toBeNull()
  })

  it('returns null when JSON-LD is invalid JSON', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {invalid json here}
      </script>
    </head><body></body></html>`

    expect(extractJsonLdRecipe(html)).toBeNull()
  })

  it('handles recipe with missing optional fields', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Minimal Recipe",
        "recipeIngredient": ["100g butter", "200g sugar"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Minimal Recipe')
    expect(result).toContain('100g butter')
    expect(result).not.toContain('Time:')
    expect(result).not.toContain('Instructions:')
  })

  it('handles totalTime without prep/cook breakdown', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Quick Dish",
        "totalTime": "PT1H15M",
        "recipeIngredient": ["200g rice"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Total: 75 min')
  })

  it('handles recipeYield as array', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Batch Recipe",
        "recipeYield": ["8", "8 servings"],
        "recipeIngredient": ["1kg flour"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Servings: 8')
  })

  it('skips non-Recipe JSON-LD and finds Recipe in later script', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": "WebSite", "name": "Blog"}
      </script>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Found Recipe With Enough Content",
        "recipeIngredient": ["3 eggs", "200g flour", "100ml milk"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Found Recipe With Enough Content')
  })

  it('returns null for recipe with too little content', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "X"
      }
      </script>
    </head><body></body></html>`

    // Name is "X" with no ingredients — formatted text will be < 50 chars
    expect(extractJsonLdRecipe(html)).toBeNull()
  })
})

describe('fetchRecipeFromUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('blocks localhost URLs', async () => {
    await expect(fetchRecipeFromUrl('https://localhost/recipe')).rejects.toThrow(
      'Cannot fetch from private or local addresses',
    )
  })

  it('blocks private IP addresses', async () => {
    await expect(fetchRecipeFromUrl('https://192.168.1.1/recipe')).rejects.toThrow(
      'Cannot fetch from private or local addresses',
    )
    await expect(fetchRecipeFromUrl('https://10.0.0.1/recipe')).rejects.toThrow(
      'Cannot fetch from private or local addresses',
    )
    await expect(fetchRecipeFromUrl('https://172.16.0.1/recipe')).rejects.toThrow(
      'Cannot fetch from private or local addresses',
    )
  })

  it('throws RecipeParseError on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } }),
    )

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(RecipeParseError)
    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      "We couldn't import from that URL",
    )
  })

  it('throws RecipeParseError for non-HTML content type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      'does not point to a web page',
    )
  })

  it('throws RecipeParseError when extracted text is too short', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>Hi</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      'Could not extract enough content',
    )
  })

  it('returns stripped text content on success', async () => {
    const html = `<html><body>
      <h1>Chicken Stir Fry</h1>
      <p>Serves 4. A delicious quick weeknight dinner with fresh vegetables and tender chicken.</p>
      <ul><li>500g chicken breast</li><li>2 tbsp soy sauce</li></ul>
    </body></html>`

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    const result = await fetchRecipeFromUrl('https://example.com/recipe')
    expect(result).toContain('Chicken Stir Fry')
    expect(result).toContain('500g chicken breast')
    expect(result).not.toContain('<')
  })

  it('throws RecipeParseError on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(RecipeParseError)
    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      "We couldn't import from that URL",
    )
  })

  it('uses browser-like User-Agent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '<html><body><p>Some recipe content that is long enough to pass the check</p></body></html>',
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      ),
    )

    await fetchRecipeFromUrl('https://example.com/recipe')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/recipe',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Mozilla/5.0'),
        }),
      }),
    )
  })

  it('returns JSON-LD recipe text when available', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "JSON-LD Chicken Curry",
        "recipeIngredient": ["500g chicken", "200ml coconut milk", "2 tbsp curry paste"],
        "recipeInstructions": [{"@type": "HowToStep", "text": "Cook chicken with curry paste."}]
      }
      </script>
    </head><body><p>Lots of blog noise and ads here...</p></body></html>`

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    const result = await fetchRecipeFromUrl('https://example.com/recipe')
    expect(result).toContain('JSON-LD Chicken Curry')
    expect(result).toContain('500g chicken')
    expect(result).not.toContain('blog noise')
  })

  it('truncates stripped HTML to 10k characters when no JSON-LD', async () => {
    // Create HTML that produces text > 10k characters
    const longContent = 'A'.repeat(15000)
    const html = `<html><body><p>${longContent}</p></body></html>`

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    const result = await fetchRecipeFromUrl('https://example.com/recipe')
    expect(result.length).toBeLessThanOrEqual(10000)
  })
})

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

describe('exported constants', () => {
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

  it('has valid MAX_GRAMS_PER_SERVING', () => {
    expect(MAX_GRAMS_PER_SERVING).toBeGreaterThan(0)
  })

  it('has valid DEFAULT_GRAMS_PER_PIECE', () => {
    expect(DEFAULT_GRAMS_PER_PIECE).toBeGreaterThan(0)
  })

  it('has CUP_CONVERSIONS for all expected categories', () => {
    expect(CUP_CONVERSIONS.spice).toBeDefined()
    expect(CUP_CONVERSIONS.dairy).toBeDefined()
    expect(CUP_CONVERSIONS.protein).toBeDefined()
    expect(CUP_CONVERSIONS.default).toBeDefined()
  })

  it('exports RecipeExtractionSchema as a Zod schema', () => {
    expect(RecipeExtractionSchema).toBeDefined()
    expect(RecipeExtractionSchema.parse).toBeDefined()
  })
})
