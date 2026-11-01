import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pantryShoppingLines } from './pantry-shopping-lines'
import type { NeededIngredient } from './shopping-list'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pantryItem: { findMany: vi.fn() },
    ingredient: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'

const mockPantry = vi.mocked(prisma.pantryItem.findMany)
const mockCatalogue = vi.mocked(prisma.ingredient.findMany)

const TODAY = new Date('2026-11-01T00:00:00Z')

/** The global catalogue rows the cover table names, plus the chickpea pair. */
const CATALOGUE = ['basil', 'fresh basil', 'dried basil', 'chickpeas', 'dried chickpeas'].map(
  (name) => ({ id: `ing-${name.replace(' ', '-')}`, name }),
)

const id = (name: string) => `ing-${name.replace(' ', '-')}`

function ingredient(name: string) {
  return {
    id: id(name),
    name,
    category: 'spice' as const,
    defaultUnit: 'g' as const,
    gramsPerPiece: null,
    measuredByVolume: false,
  }
}

/** A plan that needs `grams` of each named row. */
function needs(...lines: [name: string, grams: number][]): Map<string, NeededIngredient> {
  return new Map(
    lines.map(([name, grams]) => [
      id(name),
      {
        ingredient: ingredient(name),
        quantity: grams,
        mealCount: 1,
        earliestNeededDate: TODAY,
        isVague: false,
        originalPhrase: null,
      },
    ]),
  )
}

/** Pantry rows: `null` is "have some". */
function pantry(...rows: [name: string, quantity: number | null, isStaple?: boolean][]) {
  mockPantry.mockResolvedValue(
    rows.map(([name, quantity, isStaple = false]) => ({
      ingredientId: id(name),
      quantity,
      isStaple,
      ingredient: ingredient(name),
    })) as never,
  )
}

const listed = async (needed: Map<string, NeededIngredient>) =>
  (await pantryShoppingLines(needed, 'household-1', 'en', TODAY)).map((line) => [
    line.ingredient.name,
    line.shoppingQuantity,
  ])

beforeEach(() => {
  vi.clearAllMocks()
  mockCatalogue.mockImplementation((async (args: { where: { name: { in: string[] } } }) =>
    CATALOGUE.filter((row) => args.where.name.in.includes(row.name))) as never)
})

describe('pantryShoppingLines — herb form covers (HON-1558)', () => {
  it('lists no basil when dried basil is at home, with no basil row', async () => {
    pantry(['dried basil', null])
    expect(await listed(needs(['basil', 10]))).toEqual([])
  })

  it('lists no basil when fresh basil is at home, with no basil row', async () => {
    pantry(['fresh basil', null])
    expect(await listed(needs(['basil', 10]))).toEqual([])
  })

  it('lists no basil when dried basil has a counted amount', async () => {
    pantry(['dried basil', 2])
    expect(await listed(needs(['basil', 10]))).toEqual([])
  })

  it('lists fresh basil when only dried basil is at home', async () => {
    pantry(['dried basil', null])
    expect(await listed(needs(['fresh basil', 20]))).toEqual([['fresh basil', 20]])
  })

  it('lists chickpeas when only dried chickpeas are at home', async () => {
    pantry(['dried chickpeas', null])
    expect(await listed(needs(['chickpeas', 400]))).toEqual([['chickpeas', 400]])
  })

  it('lists basil when the dried basil has run out', async () => {
    pantry(['dried basil', 0])
    expect(await listed(needs(['basil', 10]))).toEqual([['basil', 10]])
  })

  it('lists no basil when the basil row ran out and dried basil is at home', async () => {
    pantry(['basil', 0], ['dried basil', null])
    expect(await listed(needs(['basil', 10]))).toEqual([])
  })

  it('lists no basil when the basil row holds too little and dried basil is at home', async () => {
    pantry(['basil', 2], ['dried basil', null])
    expect(await listed(needs(['basil', 10]))).toEqual([])
  })

  it('still restocks a basil staple at 0 when dried basil is at home', async () => {
    pantry(['basil', 0, true], ['dried basil', null])
    expect(await listed(needs(['basil', 10]))).toEqual([['basil', 10]])
  })
})
