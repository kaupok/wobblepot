import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import { fuzzySearchIngredient } from './fuzzy-ingredient-match'

const mockQueryRaw = vi.mocked(prisma.$queryRaw)

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
        source: 'global',
      },
    ]
    mockQueryRaw.mockResolvedValue(mockResults)

    const results = await fuzzySearchIngredient('chicken breast')
    expect(results).toEqual(mockResults)
  })

  it('accepts optional householdId and locale without throwing', async () => {
    mockQueryRaw.mockResolvedValue([])
    await fuzzySearchIngredient('sibul', { householdId: 'hh-1', locale: 'et' })
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('returns the top result regardless of source — caller does not branch on source', async () => {
    // Simulates DB returning rows pre-ordered by source priority then similarity.
    // The matcher takes the first row; this verifies it does not require `source` to be 'global'.
    const mockResults = [
      {
        id: 'ing-translation',
        name: 'onion',
        category: 'vegetable',
        subcategory: null,
        defaultUnit: 'piece',
        gramsPerPiece: 110,
        calories: 40,
        protein: 1.1,
        carbs: 9.3,
        fat: 0.1,
        similarity: 0.95,
        source: 'translation',
      },
    ]
    mockQueryRaw.mockResolvedValue(mockResults)

    const results = await fuzzySearchIngredient('sibul', { locale: 'et' })
    expect(results[0]?.id).toBe('ing-translation')
    expect(results[0]?.name).toBe('onion')
  })
})
