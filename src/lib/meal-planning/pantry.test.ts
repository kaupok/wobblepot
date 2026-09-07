import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPantryIngredientNames, compareIngredientIds } from './pantry'

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

describe('compareIngredientIds', () => {
  it('orders by code unit, not by locale', () => {
    // The whole point of the comparator: `Z` is code unit 90 and `a` is 97, so
    // code-unit order puts `ing-Zucchini` first. Every locale-aware collation
    // does the opposite, which is why `localeCompare` must never be swapped in
    // here — it resolves the runtime's default locale, so two processes would
    // take the pantry row locks in different orders and deadlock.
    expect(compareIngredientIds('ing-Zucchini', 'ing-apple')).toBeLessThan(0)
    expect('ing-Zucchini'.localeCompare('ing-apple')).toBeGreaterThan(0)
  })

  it('returns 0 for equal ids', () => {
    expect(compareIngredientIds('ing-1', 'ing-1')).toBe(0)
  })

  it('is antisymmetric', () => {
    expect(compareIngredientIds('ing-a', 'ing-b')).toBeLessThan(0)
    expect(compareIngredientIds('ing-b', 'ing-a')).toBeGreaterThan(0)
  })

  it('sorts an array into a deterministic order regardless of input order', () => {
    const ids = ['ing-c', 'ing-A', 'ing-b', 'ing-10', 'ing-2']
    const sorted = [...ids].sort(compareIngredientIds)

    expect(sorted).toEqual(['ing-10', 'ing-2', 'ing-A', 'ing-b', 'ing-c'])
    // Any starting order lands on the same result — that is the invariant the
    // lock ordering depends on.
    expect([...ids].reverse().sort(compareIngredientIds)).toEqual(sorted)
  })
})
