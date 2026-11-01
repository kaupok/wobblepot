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
const CATALOGUE = [
  'basil',
  'fresh basil',
  'dried basil',
  'coriander',
  'fresh coriander',
  'oregano',
  'fresh oregano',
  'chickpeas',
  'dried chickpeas',
].map((name) => ({ id: `ing-${name.replace(' ', '-')}`, name }))

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
      id: `pantry-${name.replace(' ', '-')}`,
      quantity,
      isStaple,
      ingredient: ingredient(name),
    })) as never,
  )
}

const listed = async (needed: Map<string, NeededIngredient>) =>
  (await pantryShoppingLines(needed, 'household-1', 'en', TODAY)).lines.map((line) => [
    line.ingredient.name,
    line.shoppingQuantity,
  ])

/** The at-home needs: name, covered amount, and the pantry rows that keep it at home. */
const atHome = async (needed: Map<string, NeededIngredient>) =>
  (await pantryShoppingLines(needed, 'household-1', 'en', TODAY)).atHome.map((line) => [
    line.ingredient.name,
    line.coveredQuantity,
    line.pantryRows.map((r) => r.id),
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

describe('pantryShoppingLines — a bare herb covers its fresh row (HON-1567)', () => {
  it('lists no fresh basil when basil is at home', async () => {
    pantry(['basil', null])
    expect(await listed(needs(['fresh basil', 20]))).toEqual([])
  })

  it('lists no fresh basil when basil has a counted amount', async () => {
    pantry(['basil', 2])
    expect(await listed(needs(['fresh basil', 20]))).toEqual([])
  })

  it('lists no fresh coriander when coriander is at home', async () => {
    pantry(['coriander', null])
    expect(await listed(needs(['fresh coriander', 15]))).toEqual([])
  })

  it('lists fresh oregano when only oregano, a dried row, is at home', async () => {
    pantry(['oregano', null])
    expect(await listed(needs(['fresh oregano', 10]))).toEqual([['fresh oregano', 10]])
  })

  it('lists dried basil when only basil is at home', async () => {
    pantry(['basil', null])
    expect(await listed(needs(['dried basil', 5]))).toEqual([['dried basil', 5]])
  })

  it('lists fresh basil when the basil has run out', async () => {
    pantry(['basil', 0])
    expect(await listed(needs(['fresh basil', 20]))).toEqual([['fresh basil', 20]])
  })
})

describe('pantryShoppingLines — ran out (HON-1578)', () => {
  it('marks a line ran out when its row is at 0', async () => {
    pantry(['chickpeas', 0])
    const { lines } = await pantryShoppingLines(
      needs(['chickpeas', 400]),
      'household-1',
      'en',
      TODAY,
    )
    expect(lines.map((line) => [line.ingredient.name, line.ranOut])).toEqual([['chickpeas', true]])
  })

  it('does not mark a line with no pantry row or a partial amount', async () => {
    pantry(['chickpeas', 100])
    const { lines } = await pantryShoppingLines(
      needs(['chickpeas', 400], ['basil', 10]),
      'household-1',
      'en',
      TODAY,
    )
    expect(lines.map((line) => [line.ingredient.name, line.ranOut])).toEqual([
      ['chickpeas', undefined],
      ['basil', undefined],
    ])
  })
})

describe('pantryShoppingLines — at home (HON-1578)', () => {
  it('puts a "have some" row at home for the full need', async () => {
    pantry(['basil', null])
    expect(await atHome(needs(['basil', 10]))).toEqual([['basil', 10, ['pantry-basil']]])
  })

  it('puts a staple at home, and not on the list', async () => {
    pantry(['oregano', 3, true])
    const needed = needs(['oregano', 10])
    expect(await atHome(needed)).toEqual([['oregano', 10, ['pantry-oregano']]])
    expect(await listed(needed)).toEqual([])
  })

  it('puts a partial amount in both lists: the pantry amount at home, the rest to buy', async () => {
    pantry(['chickpeas', 200])
    const needed = needs(['chickpeas', 500])
    expect(await atHome(needed)).toEqual([['chickpeas', 200, ['pantry-chickpeas']]])
    expect(await listed(needed)).toEqual([['chickpeas', 300]])
  })

  it('puts a row at 0 on the list only', async () => {
    pantry(['chickpeas', 0])
    expect(await atHome(needs(['chickpeas', 400]))).toEqual([])
  })

  it('puts a staple at 0 on the list only', async () => {
    pantry(['oregano', 0, true])
    expect(await atHome(needs(['oregano', 10]))).toEqual([])
  })

  it('leaves out a need with no pantry row', async () => {
    pantry()
    expect(await atHome(needs(['chickpeas', 400]))).toEqual([])
  })

  it('puts a bare herb at home through the fresh row that covers it', async () => {
    pantry(['basil', 0], ['fresh basil', null])
    expect(await atHome(needs(['basil', 10]))).toEqual([['basil', 10, ['pantry-fresh-basil']]])
  })

  it('names every row that keeps a herb at home, its own row first', async () => {
    pantry(['basil', 10], ['fresh basil', null], ['dried basil', 2])
    expect(await atHome(needs(['basil', 20]))).toEqual([
      ['basil', 20, ['pantry-basil', 'pantry-fresh-basil', 'pantry-dried-basil']],
    ])
  })

  it('puts a fresh herb at home through the bare row that covers it', async () => {
    pantry(['basil', 2])
    expect(await atHome(needs(['fresh basil', 20]))).toEqual([
      ['fresh basil', 20, ['pantry-basil']],
    ])
  })
})
