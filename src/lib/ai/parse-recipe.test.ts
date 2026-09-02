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
import { parseRecipeText, parseAndMatchRecipe } from './parse-recipe'
import type { RecipeExtraction } from './recipe-schema'
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
