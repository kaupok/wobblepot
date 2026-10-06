// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IngredientMatchResult, MatchedIngredient } from './match-ingredients'
import { translateMatchResults } from './translate-match-results'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ingredientTranslation: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'

const mockTranslationFindMany = vi.mocked(prisma.ingredientTranslation.findMany)

function matched(
  id: string,
  name: string,
  overrides: Partial<MatchedIngredient> = {},
): MatchedIngredient {
  return {
    type: 'matched',
    extractedName: name,
    extractedQuantity: 1,
    extractedUnit: 'g',
    originalText: name,
    ingredient: {
      id,
      name,
      category: 'spice',
      subcategory: null,
      defaultUnit: 'g',
      measuredByVolume: false,
      gramsPerPiece: null,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
    convertedQuantity: 1,
    isVague: false,
    matchedName: name,
    similarityScore: 0.9,
    lowConfidence: false,
    ...overrides,
  }
}

const unmatched: IngredientMatchResult = {
  type: 'unmatched',
  extractedName: 'dragon fruit dust',
  extractedQuantity: 1,
  extractedUnit: 'g',
  originalText: 'dragon fruit dust',
  isVague: false,
}

describe('translateMatchResults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns English results unchanged without querying', async () => {
    const results = [matched('ing-pepper', 'black pepper')]

    expect(await translateMatchResults(results, 'en')).toBe(results)
    expect(mockTranslationFindMany).not.toHaveBeenCalled()
  })

  it('overlays the locale name on matched ingredients and their alternatives', async () => {
    mockTranslationFindMany.mockResolvedValue([
      { ingredientId: 'ing-pepper', name: 'must pipar' },
      { ingredientId: 'ing-white-pepper', name: 'valge pipar' },
    ] as never)

    const results = [
      matched('ing-pepper', 'black pepper', {
        matchedName: 'must pipar',
        lowConfidence: true,
        alternatives: [
          {
            id: 'ing-pepper',
            name: 'black pepper',
            category: 'spice',
            defaultUnit: 'g',
            measuredByVolume: false,
            similarity: 0.6,
          },
          {
            id: 'ing-white-pepper',
            name: 'white pepper',
            category: 'spice',
            defaultUnit: 'g',
            measuredByVolume: false,
            similarity: 0.5,
          },
        ],
      }),
    ]

    const [translated] = await translateMatchResults(results, 'et')

    expect(mockTranslationFindMany).toHaveBeenCalledWith({
      where: { locale: 'et', ingredientId: { in: ['ing-pepper', 'ing-white-pepper'] } },
      select: { ingredientId: true, name: true },
    })
    expect(translated).toMatchObject({
      ingredient: { id: 'ing-pepper', name: 'must pipar' },
      alternatives: [
        { id: 'ing-pepper', name: 'must pipar' },
        { id: 'ing-white-pepper', name: 'valge pipar' },
      ],
    })
  })

  it('keeps the English name where no translation row exists, and passes unmatched rows through', async () => {
    mockTranslationFindMany.mockResolvedValue([
      { ingredientId: 'ing-onion', name: 'sibul' },
    ] as never)

    const results = [
      matched('ing-onion', 'onion'),
      matched('ing-own', 'grandma spice mix'),
      unmatched,
    ]

    const translated = await translateMatchResults(results, 'et')

    expect(translated[0]).toMatchObject({ ingredient: { name: 'sibul' } })
    expect(translated[1]).toMatchObject({ ingredient: { name: 'grandma spice mix' } })
    expect(translated[2]).toBe(unmatched)
  })

  it('skips the query when nothing matched', async () => {
    const results = [unmatched]

    expect(await translateMatchResults(results, 'et')).toBe(results)
    expect(mockTranslationFindMany).not.toHaveBeenCalled()
  })
})
