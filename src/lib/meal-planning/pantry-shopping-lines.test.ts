import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IngredientCategory } from '@/generated/prisma/enums'

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

function ingredient(name: string, category: IngredientCategory = 'spice', subcategory?: string) {
  return {
    id: id(name),
    name,
    category,
    subcategory: subcategory ?? null,
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

/** Pantry rows: `null` is "have some"; `low` marks the row running low. */
function pantry(
  ...rows: [name: string, quantity: number | null, isStaple?: boolean, low?: 'low'][]
) {
  mockPantry.mockResolvedValue(
    rows.map(([name, quantity, isStaple = false, low]) => ({
      ingredientId: id(name),
      id: `pantry-${name.replace(' ', '-')}`,
      quantity,
      isStaple,
      lowAt: low ? new Date('2026-10-31T18:00:00Z') : null,
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

const DAY_3 = new Date('2026-11-03T00:00:00Z')

/** One need with the fields the check reads. */
function need(
  name: string,
  grams: number,
  opts: {
    category: IngredientCategory
    subcategory?: string
    mealCount: number
    earliestNeededDate?: Date
    isVague?: boolean
  },
): [string, NeededIngredient] {
  return [
    id(name),
    {
      ingredient: ingredient(name, opts.category, opts.subcategory),
      quantity: grams,
      mealCount: opts.mealCount,
      earliestNeededDate: opts.earliestNeededDate ?? TODAY,
      isVague: opts.isVague ?? false,
      originalPhrase: opts.isVague ? 'to taste' : null,
    },
  ]
}

/** The real week of 2026-11-02 in small: what the check keeps and what it leaves out. */
const WEEK = new Map([
  need('carrot', 1160, { category: 'vegetable', mealCount: 4, earliestNeededDate: DAY_3 }),
  need('garlic', 30, { category: 'vegetable', mealCount: 3 }),
  need('frozen berries', 400, { category: 'fruit', subcategory: 'frozen', mealCount: 2 }),
  need('lemon', 1, { category: 'fruit', mealCount: 1 }),
  need('olive oil', 90, { category: 'fat', mealCount: 5 }),
  need('water', 1500, { category: 'condiment', subcategory: 'liquid', mealCount: 2 }),
  need('salt', 6, { category: 'spice', mealCount: 2, isVague: true }),
  need('minced beef', 800, { category: 'protein', mealCount: 2 }),
  need('basil', 20, { category: 'spice', subcategory: 'herb', mealCount: 2 }),
])

const WEEK_PANTRY: [name: string, quantity: number | null, isStaple?: boolean][] = [
  ['carrot', null],
  ['garlic', null, true],
  ['frozen berries', null, true],
  ['lemon', null],
  ['olive oil', null, true],
  ['water', null],
  ['salt', null],
  ['minced beef', 500],
  ['fresh basil', null],
]

describe('pantryShoppingLines — check (HON-1584)', () => {
  it('checks the "have some" needs that two or more meals use', async () => {
    pantry(...WEEK_PANTRY)
    const { check } = await pantryShoppingLines(WEEK, 'household-1', 'en', TODAY)
    expect(check).toEqual([
      {
        ingredientId: 'ing-carrot',
        ingredient: ingredient('carrot', 'vegetable'),
        totalQuantity: 1160,
        mealCount: 4,
        earliestNeededDate: DAY_3,
        pantryRows: [{ id: 'pantry-carrot', quantity: null }],
        isStaple: false,
      },
      {
        ingredientId: 'ing-garlic',
        ingredient: ingredient('garlic', 'vegetable'),
        totalQuantity: 30,
        mealCount: 3,
        earliestNeededDate: TODAY,
        pantryRows: [{ id: 'pantry-garlic', quantity: null }],
        isStaple: true,
      },
      {
        ingredientId: 'ing-frozen-berries',
        ingredient: ingredient('frozen berries', 'fruit', 'frozen'),
        totalQuantity: 400,
        mealCount: 2,
        earliestNeededDate: TODAY,
        pantryRows: [{ id: 'pantry-frozen-berries', quantity: null }],
        isStaple: true,
      },
      {
        ingredientId: 'ing-basil',
        ingredient: ingredient('basil', 'spice', 'herb'),
        totalQuantity: 20,
        mealCount: 2,
        earliestNeededDate: TODAY,
        pantryRows: [{ id: 'pantry-fresh-basil', quantity: null }],
        isStaple: false,
      },
    ])
  })

  it('leaves the lines to buy as they were', async () => {
    pantry(...WEEK_PANTRY)
    expect(await listed(WEEK)).toEqual([['minced beef', 300]])
  })

  it('leaves out a vague need that is not a cupboard item', async () => {
    pantry(['parsley', null])
    const needed = new Map([
      need('parsley', 10, { category: 'spice', subcategory: 'herb', mealCount: 3, isVague: true }),
    ])
    const { check } = await pantryShoppingLines(needed, 'household-1', 'en', TODAY)
    expect(check).toEqual([])
  })

  it('leaves out a need with a counted row beside a "have some" cover', async () => {
    pantry(['basil', 5], ['fresh basil', null])
    const needed = new Map([
      need('basil', 20, { category: 'spice', subcategory: 'herb', mealCount: 2 }),
    ])
    const { check } = await pantryShoppingLines(needed, 'household-1', 'en', TODAY)
    expect(check).toEqual([])
  })
})

describe('pantryShoppingLines — a ran-out staple is dated by its first need (HON-1584)', () => {
  it('dates a staple at 0 that a meal needs on day 3 by day 3', async () => {
    pantry(['onion', 0, true])
    const needed = new Map([
      need('onion', 300, { category: 'vegetable', mealCount: 1, earliestNeededDate: DAY_3 }),
    ])
    const { lines } = await pantryShoppingLines(needed, 'household-1', 'en', TODAY)
    expect(lines.map((line) => [line.ingredient.name, line.earliestNeededDate])).toEqual([
      ['onion', DAY_3],
    ])
  })

  it('dates a staple at 0 that nothing needs by today', async () => {
    pantry(['onion', 0, true])
    const { lines } = await pantryShoppingLines(new Map(), 'household-1', 'en', TODAY)
    expect(lines.map((line) => [line.ingredient.name, line.earliestNeededDate])).toEqual([
      ['onion', TODAY],
    ])
  })
})

const WEDNESDAY = new Date('2026-11-04T00:00:00Z')

describe('pantryShoppingLines — running low (HON-1586)', () => {
  /** Each line as name, amount to buy, date, and its low flag. */
  const lowLines = async (needed: Map<string, NeededIngredient>) =>
    (await pantryShoppingLines(needed, 'household-1', 'en', TODAY)).lines.map((line) => [
      line.ingredient.name,
      line.shoppingQuantity,
      line.earliestNeededDate,
      line.low,
    ])

  it('lists a low onion staple needed Wednesday once, with no amount, and keeps it at home', async () => {
    pantry(['onion', null, true, 'low'])
    const needed = new Map([
      need('onion', 300, { category: 'vegetable', mealCount: 1, earliestNeededDate: WEDNESDAY }),
    ])
    expect(await lowLines(needed)).toEqual([['onion', 0, WEDNESDAY, true]])
    expect(await atHome(needed)).toEqual([['onion', 300, ['pantry-onion']]])
  })

  it('lists low tahini that nothing needs once, dated today', async () => {
    pantry(['tahini', null, false, 'low'])
    expect(await lowLines(new Map())).toEqual([['tahini', 0, TODAY, true]])
  })

  it('lists the shortfall of a low carrot at 300 g against a 500 g need', async () => {
    pantry(['carrot', 300, false, 'low'])
    expect(await lowLines(needs(['carrot', 500]))).toEqual([['carrot', 200, TODAY, true]])
  })

  it('lists a low carrot at 300 g against a 200 g need with no amount', async () => {
    pantry(['carrot', 300, false, 'low'])
    expect(await lowLines(needs(['carrot', 200]))).toEqual([['carrot', 0, TODAY, true]])
  })

  it('leaves a low row that 3 meals use out of the check', async () => {
    pantry(['carrot', null, false, 'low'])
    const needed = new Map([need('carrot', 900, { category: 'vegetable', mealCount: 3 })])
    const { check } = await pantryShoppingLines(needed, 'household-1', 'en', TODAY)
    expect(check).toEqual([])
  })

  it('does not mark a line low when its row is not', async () => {
    pantry(['carrot', 300])
    expect(await lowLines(needs(['carrot', 500]))).toEqual([['carrot', 200, TODAY, undefined]])
  })
})
