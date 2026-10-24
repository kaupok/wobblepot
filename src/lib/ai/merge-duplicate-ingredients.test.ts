import { describe, it, expect, vi } from 'vitest'

// The matcher module imports the Prisma client for its search; the merge
// itself reads nothing.
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { mergeDuplicateIngredients } from './match-ingredients'
import type {
  IngredientMatchResult,
  MatchedIngredient,
  UnmatchedIngredient,
} from './match-ingredients'

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
      measuredByVolume: false,
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

  it('keeps the merged row low-confidence when the second row was (HON-1305)', () => {
    const alternatives = [
      {
        id: 'ing-olive-oil',
        name: 'olive oil',
        category: 'fat' as const,
        defaultUnit: 'g' as const,
        measuredByVolume: false,
        similarity: 0.58,
      },
    ]
    const results: IngredientMatchResult[] = [
      makeMatched(),
      makeMatched({ extractedName: 'olive oyl', lowConfidence: true, alternatives }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged).toHaveLength(1)
    // The unsure row's name, so the question is about the word that needs it.
    expect(merged[0]).toMatchObject({
      extractedName: 'olive oyl',
      lowConfidence: true,
      alternatives,
    })
  })

  it('keeps the merged vague row low-confidence when the second row was (HON-1305)', () => {
    const alternatives = [
      {
        id: 'ing-olive-oil',
        name: 'olive oil',
        category: 'fat' as const,
        defaultUnit: 'g' as const,
        measuredByVolume: false,
        similarity: 0.58,
      },
    ]
    const results: IngredientMatchResult[] = [
      makeMatched({ isVague: true, originalPhrase: 'to taste', convertedQuantity: 0 }),
      makeMatched({ lowConfidence: true, alternatives }),
    ]

    const merged = mergeDuplicateIngredients(results, 4)

    expect(merged[0]).toMatchObject({ isVague: true, lowConfidence: true, alternatives })
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
          measuredByVolume: false,
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
