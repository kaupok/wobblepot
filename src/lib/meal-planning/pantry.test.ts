import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPantryIngredientNames } from './pantry'

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    pantryItem: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'

const mockFindMany = vi.mocked(prisma.pantryItem.findMany)

describe('getPantryIngredientNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ingredient names for items in stock', async () => {
    mockFindMany.mockResolvedValue([
      { ingredient: { name: 'Chicken breast' } },
      { ingredient: { name: 'Rice' } },
    ] as never)

    const result = await getPantryIngredientNames('household-1')

    expect(result).toEqual(['Chicken breast', 'Rice'])
  })

  it('returns empty array when no pantry items', async () => {
    mockFindMany.mockResolvedValue([])

    const result = await getPantryIngredientNames('household-1')

    expect(result).toEqual([])
  })

  it('queries with correct filters excluding staples and ran-out items', async () => {
    mockFindMany.mockResolvedValue([])

    await getPantryIngredientNames('household-1')

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        householdId: 'household-1',
        isStaple: false,
        OR: [{ quantity: null }, { quantity: { gt: 0 } }],
      },
      select: {
        ingredient: {
          select: { name: true },
        },
      },
      orderBy: {
        ingredient: { name: 'asc' },
      },
    })
  })
})
