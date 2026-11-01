import { describe, expect, it, vi } from 'vitest'

import { getStartOfTodayInTimezone } from '@/lib/meal-planning/dates'
import { loadPantry, type PantryHousehold } from '@/lib/meal-planning/load-pantry'
import { prisma } from '@/lib/prisma'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'

// Runs against PGlite through the `unit-db` project (HON-1186). Every query is
// real. The one mock is i18n plumbing: `getTranslations` from
// `next-intl/server` throws outside the Next.js runtime ("not supported in
// Client Components"), so it resolves against the real catalogs here instead.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({
        locale,
        messages: (locale === 'et' ? etMessages : enMessages) as never,
        namespace: namespace as never,
      }),
  }
})

const nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 }

const TIMEZONE = 'UTC'
const today = () => getStartOfTodayInTimezone(TIMEZONE)
const daysFromToday = (days: number) => {
  const date = today()
  date.setDate(date.getDate() + days)
  return date
}

/** Two members at one portion each: a household of 2. */
const members = [
  { preferences: { portionMultiplier: 1 } },
  { preferences: { portionMultiplier: 1 } },
]

async function household(locale = 'en'): Promise<PantryHousehold> {
  const row = await prisma.household.create({
    data: { name: 'Alder', locale, timezone: TIMEZONE },
  })
  return { id: row.id, locale, timezone: TIMEZONE, members }
}

type IngredientInput = {
  name: string
  et?: string
  category?: 'protein' | 'carb' | 'dairy' | 'spice' | 'fat' | 'vegetable'
  defaultUnit?: 'g' | 'piece'
  gramsPerPiece?: number
  measuredByVolume?: boolean
}

async function ingredient(id: string, input: IngredientInput) {
  await prisma.ingredient.create({
    data: {
      id,
      name: input.name,
      category: input.category ?? 'carb',
      defaultUnit: input.defaultUnit ?? 'g',
      gramsPerPiece: input.gramsPerPiece,
      measuredByVolume: input.measuredByVolume ?? false,
      ...nutrition,
      ...(input.et ? { translations: { create: { locale: 'et', name: input.et } } } : {}),
    },
  })
}

async function stock(householdId: string, ingredientId: string, isStaple = false) {
  await prisma.pantryItem.create({ data: { householdId, ingredientId, isStaple } })
}

type Component = {
  ingredientId: string
  quantityPerServing: number
  isVague?: boolean
  originalPhrase?: string | null
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const
let mealCount = 0

/** Plans a meal of `components` on the household's plan, `days` from today. */
async function plan(
  householdId: string,
  components: Component[],
  entry: { days?: number; servingOverride?: number | null; status?: 'planned' | 'skipped' } = {},
) {
  const { id: planId } = await prisma.mealPlan.upsert({
    where: { householdId },
    create: { householdId },
    update: {},
  })
  const meal = await prisma.meal.create({
    data: { name: `Meal ${++mealCount}`, components: { create: components } },
  })
  const taken = await prisma.mealPlanEntry.count({
    where: { planId, date: daysFromToday(entry.days ?? 0) },
  })
  return prisma.mealPlanEntry.create({
    data: {
      planId,
      mealId: meal.id,
      date: daysFromToday(entry.days ?? 0),
      mealType: MEAL_TYPES[taken]!,
      servingOverride: entry.servingOverride ?? null,
      status: entry.status ?? 'planned',
    },
  })
}

const names = (result: { items: { ingredient: { name: string } }[] }) =>
  result.items.map((item) => item.ingredient.name)

/** A global herb row: the migrations seed some of them, so reuse one that exists. */
async function herb(name: string): Promise<string> {
  const row =
    (await prisma.ingredient.findFirst({ where: { householdId: null, name } })) ??
    (await prisma.ingredient.create({
      data: { name, category: 'spice', defaultUnit: 'g', ...nutrition },
    }))
  return row.id
}

describe('loadPantry', () => {
  it("returns the household's items, staples first, then A–Z", async () => {
    const alder = await household()
    await ingredient('ing-oil', { name: 'Olive oil', category: 'fat' })
    await ingredient('ing-chicken', { name: 'Chicken breast', category: 'protein' })
    await ingredient('ing-barley', { name: 'Barley' })
    await stock(alder.id, 'ing-oil', true)
    await stock(alder.id, 'ing-chicken')
    await stock(alder.id, 'ing-barley')

    const result = await loadPantry(alder, { days: null })

    expect(names(result)).toEqual(['Olive oil', 'Barley', 'Chicken breast'])
    expect(result.items[0]).toMatchObject({
      ingredientId: 'ing-oil',
      ingredient: { id: 'ing-oil', category: 'fat', defaultUnit: 'g', displayUnit: 'g' },
      quantity: null,
      isStaple: true,
    })
    expect(result.windowDays).toBeNull()
  })

  it("leaves out another household's pantry", async () => {
    const alder = await household()
    const birch = await household()
    await ingredient('ing-oil', { name: 'Olive oil' })
    await stock(birch.id, 'ing-oil')

    expect(await loadPantry(alder, { days: null })).toEqual({ items: [], windowDays: null })
  })

  // English A–Z (apple, chocolate, onion, sugar) is not Estonian A–Z (sibul,
  // suhkur, šokolaad, õun): the sort runs on the translated name, with
  // Estonian collation (HON-920).
  it('orders an et household by the Estonian names, with Estonian collation', async () => {
    const birch = await household('et')
    const rows = [
      ['ing-apple', 'Apple', 'õun'],
      ['ing-chocolate', 'Chocolate', 'šokolaad'],
      ['ing-onion', 'Onion', 'sibul'],
      ['ing-sugar', 'Sugar', 'suhkur'],
    ] as const
    for (const [id, name, et] of rows) {
      await ingredient(id, { name, et })
      await stock(birch.id, id)
    }
    await ingredient('ing-barley', { name: 'Barley', et: 'oder' })
    await stock(birch.id, 'ing-barley', true)

    const result = await loadPantry(birch, { days: null })

    expect(names(result)).toEqual(['oder', 'sibul', 'suhkur', 'šokolaad', 'õun'])
  })

  it('adds no needed quantity without a window', async () => {
    const alder = await household()
    await ingredient('ing-chicken', { name: 'Chicken breast' })
    await stock(alder.id, 'ing-chicken')
    await plan(alder.id, [{ ingredientId: 'ing-chicken', quantityPerServing: 150 }])

    const result = await loadPantry(alder, { days: null })

    expect(result.items[0]).not.toHaveProperty('neededQuantity')
    expect(result.items[0]).not.toHaveProperty('neededDisplayQuantity')
    expect(result.items[0]).not.toHaveProperty('windowDays')
  })

  it("sums the planned need in the window across meals, for the household's servings", async () => {
    const alder = await household()
    await ingredient('ing-chicken', { name: 'Chicken breast' })
    await ingredient('ing-rice', { name: 'Rice' })
    await stock(alder.id, 'ing-chicken')
    await plan(alder.id, [
      { ingredientId: 'ing-chicken', quantityPerServing: 150 },
      { ingredientId: 'ing-rice', quantityPerServing: 100 },
    ])
    await plan(alder.id, [{ ingredientId: 'ing-chicken', quantityPerServing: 200 }], { days: 6 })

    const result = await loadPantry(alder, { days: 7 })

    // Household of 2: (150 + 200) × 2 = 700 g. Rice is not in the pantry.
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          ingredientId: 'ing-chicken',
          neededQuantity: 700,
          neededDisplayQuantity: '700g',
          windowDays: 7,
          isVague: false,
        }),
      ],
      windowDays: 7,
    })
  })

  // The pane beside the shopping list counts what the list buys (HON-614),
  // so an entry's own ingredient changes count here too (HON-1243).
  it("counts the entry's replacement, not the original it replaced", async () => {
    const alder = await household()
    await ingredient('ing-chicken', { name: 'Chicken breast' })
    await ingredient('ing-tofu', { name: 'Tofu' })
    await stock(alder.id, 'ing-chicken')
    await stock(alder.id, 'ing-tofu')
    const entry = await plan(alder.id, [{ ingredientId: 'ing-chicken', quantityPerServing: 150 }])
    await prisma.mealPlanEntryComponent.create({
      data: {
        entryId: entry.id,
        originalIngredientId: 'ing-chicken',
        replacementIngredientId: 'ing-tofu',
        quantityPerServing: 120,
      },
    })

    const result = await loadPantry(alder, { days: 7 })

    // Household of 2: 2 × 120 g tofu, and no chicken.
    const needed = Object.fromEntries(
      result.items.map((item) => [item.ingredientId, item.neededQuantity ?? null]),
    )
    expect(needed).toEqual({ 'ing-chicken': null, 'ing-tofu': 240 })
  })

  it("counts only this household's planned entries inside the window", async () => {
    const alder = await household()
    const birch = await household()
    await ingredient('ing-chicken', { name: 'Chicken breast' })
    await stock(alder.id, 'ing-chicken')
    const chicken = [{ ingredientId: 'ing-chicken', quantityPerServing: 100 }]
    await plan(alder.id, chicken)
    await plan(alder.id, chicken, { days: 7 }) // past a 7-day window
    await plan(alder.id, chicken, { days: -1 }) // yesterday
    await plan(alder.id, chicken, { days: 1, status: 'skipped' })
    await plan(birch.id, chicken)

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items[0]).toMatchObject({ neededQuantity: 200 })
  })

  // The shopping list counts a dried or fresh herb as cover for the bare herb
  // (HON-1558), so the pantry row shows what the plan needs of it.
  it('shows the bare herb need on a dried herb row when no bare row is stocked', async () => {
    const alder = await household()
    const basil = await herb('basil')
    const driedBasil = await herb('dried basil')
    await stock(alder.id, driedBasil)
    await plan(alder.id, [{ ingredientId: basil, quantityPerServing: 5 }])

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items).toEqual([
      expect.objectContaining({ ingredientId: driedBasil, neededQuantity: 10 }),
    ])
  })

  it('shows the bare herb need on one form row when two are stocked', async () => {
    const alder = await household()
    const basil = await herb('basil')
    await stock(alder.id, await herb('dried basil'))
    await stock(alder.id, await herb('fresh basil'))
    await plan(alder.id, [{ ingredientId: basil, quantityPerServing: 5 }])

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items.map((item) => item.neededQuantity).filter(Boolean)).toEqual([10])
  })

  it('shows the bare herb need on the other form row when one has a need of its own', async () => {
    const alder = await household()
    const basil = await herb('basil')
    const freshBasil = await herb('fresh basil')
    const driedBasil = await herb('dried basil')
    // Fresh basil goes in first, so the pantry query reads it first.
    await stock(alder.id, freshBasil)
    await stock(alder.id, driedBasil)
    await plan(alder.id, [
      { ingredientId: freshBasil, quantityPerServing: 10 },
      { ingredientId: basil, quantityPerServing: 5 },
    ])

    const result = await loadPantry(alder, { days: 7 })
    const byId = new Map(result.items.map((item) => [item.ingredientId, item]))

    expect(byId.get(freshBasil)).toEqual(expect.objectContaining({ neededQuantity: 20 }))
    expect(byId.get(driedBasil)).toEqual(expect.objectContaining({ neededQuantity: 10 }))
  })

  it('shows the bare herb need on the form row that covers it, not on a run-out one', async () => {
    const alder = await household()
    const basil = await herb('basil')
    const driedBasil = await herb('dried basil')
    const freshBasil = await herb('fresh basil')
    // The run-out jar goes in first, so the pantry query reads it first.
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: driedBasil, quantity: 0 },
    })
    await stock(alder.id, freshBasil)
    await plan(alder.id, [{ ingredientId: basil, quantityPerServing: 5 }])

    const result = await loadPantry(alder, { days: 7 })
    const byId = new Map(result.items.map((item) => [item.ingredientId, item]))

    expect(byId.get(driedBasil)).not.toHaveProperty('neededQuantity')
    expect(byId.get(freshBasil)).toEqual(expect.objectContaining({ neededQuantity: 10 }))
  })

  it('keeps the bare herb need on the bare row when both are stocked', async () => {
    const alder = await household()
    const basil = await herb('basil')
    const driedBasil = await herb('dried basil')
    await stock(alder.id, basil)
    await stock(alder.id, driedBasil)
    await plan(alder.id, [{ ingredientId: basil, quantityPerServing: 5 }])

    const result = await loadPantry(alder, { days: 7 })
    const byId = new Map(result.items.map((item) => [item.ingredientId, item]))

    expect(byId.get(basil)).toEqual(expect.objectContaining({ neededQuantity: 10 }))
    expect(byId.get(driedBasil)).not.toHaveProperty('neededQuantity')
  })

  // A bare herb row covers its fresh row too (HON-1567), but not its dried row.
  it('shows the fresh herb need on the bare row when no fresh row is stocked', async () => {
    const alder = await household()
    const basil = await herb('basil')
    const freshBasil = await herb('fresh basil')
    await stock(alder.id, basil)
    await plan(alder.id, [{ ingredientId: freshBasil, quantityPerServing: 5 }])

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items).toEqual([
      expect.objectContaining({ ingredientId: basil, neededQuantity: 10 }),
    ])
  })

  it('shows no dried herb need on the bare row', async () => {
    const alder = await household()
    const basil = await herb('basil')
    const driedBasil = await herb('dried basil')
    await stock(alder.id, basil)
    await plan(alder.id, [{ ingredientId: driedBasil, quantityPerServing: 5 }])

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items).toEqual([expect.objectContaining({ ingredientId: basil })])
    expect(result.items[0]).not.toHaveProperty('neededQuantity')
  })

  it('reaches further with a 14-day window', async () => {
    const alder = await household()
    await ingredient('ing-chicken', { name: 'Chicken breast' })
    await stock(alder.id, 'ing-chicken')
    await plan(alder.id, [{ ingredientId: 'ing-chicken', quantityPerServing: 100 }], { days: 10 })

    expect((await loadPantry(alder, { days: 7 })).items[0]).not.toHaveProperty('neededQuantity')
    expect((await loadPantry(alder, { days: 14 })).items[0]).toMatchObject({
      neededQuantity: 200,
      windowDays: 14,
    })
  })

  // A household of 2 cooking a dinner for 6. The shopping list honours the
  // override; the pantry row must agree with it (HON-614).
  it.each([
    [6, 900],
    [null, 300],
  ])('scales the need by a servingOverride of %s', async (servingOverride, needed) => {
    const alder = await household()
    await ingredient('ing-chicken', { name: 'Chicken breast' })
    await stock(alder.id, 'ing-chicken')
    await plan(alder.id, [{ ingredientId: 'ing-chicken', quantityPerServing: 150 }], {
      servingOverride,
    })

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items[0]).toMatchObject({
      neededQuantity: needed,
      neededDisplayQuantity: `${needed}g`,
    })
  })

  // Piece quantities are stored as piece counts (HON-713).
  it('formats a piece ingredient as a count, not divided by gramsPerPiece', async () => {
    const alder = await household()
    await ingredient('ing-egg', { name: 'Eggs', defaultUnit: 'piece', gramsPerPiece: 60 })
    await stock(alder.id, 'ing-egg')
    await plan(alder.id, [{ ingredientId: 'ing-egg', quantityPerServing: 1.5 }])

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items[0]).toMatchObject({ neededDisplayQuantity: '3 pc' })
  })

  it.each([
    ['en', '1.5kg'],
    ['et', '1,5kg'],
  ])('formats kilograms for an %s household as %s', async (locale, display) => {
    const alder = await household(locale)
    await ingredient('ing-flour', { name: 'Flour' })
    await stock(alder.id, 'ing-flour')
    await plan(alder.id, [{ ingredientId: 'ing-flour', quantityPerServing: 750 }])

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items[0]).toMatchObject({ neededQuantity: 1500, neededDisplayQuantity: display })
  })

  // A liquid shows its stored grams as millilitres, 1:1 (HON-1054).
  it('formats a measured-by-volume ingredient in litres', async () => {
    const alder = await household()
    await ingredient('ing-milk', { name: 'Milk', category: 'dairy', measuredByVolume: true })
    await stock(alder.id, 'ing-milk')
    await plan(alder.id, [{ ingredientId: 'ing-milk', quantityPerServing: 750 }])

    const result = await loadPantry(alder, { days: 7 })

    expect(result.items[0]).toMatchObject({
      ingredient: { displayUnit: 'ml' },
      neededQuantity: 1500,
      neededDisplayQuantity: '1.5l',
    })
  })

  // `isVague` tells the row its display is a phrase, so it is set only when
  // the formatter swapped the phrase in (HON-783).
  it.each([
    ['to taste', 'to taste', true],
    [null, '400g', false],
  ])(
    'flags a vague need with phrase %s only when the phrase replaced the amount',
    async (originalPhrase, display, isVague) => {
      const alder = await household()
      await ingredient('ing-butter', { name: 'Butter', category: 'dairy' })
      await stock(alder.id, 'ing-butter', true)
      await plan(alder.id, [
        { ingredientId: 'ing-butter', quantityPerServing: 200, isVague: true, originalPhrase },
      ])

      const result = await loadPantry(alder, { days: 7 })

      expect(result.items[0]).toMatchObject({ neededDisplayQuantity: display, isVague })
    },
  )

  it('renders a vague need in the household language (HON-917)', async () => {
    const birch = await household('et')
    await ingredient('ing-salt', { name: 'Salt', category: 'spice', et: 'sool' })
    await stock(birch.id, 'ing-salt', true)
    await plan(birch.id, [
      {
        ingredientId: 'ing-salt',
        quantityPerServing: 1,
        isVague: true,
        originalPhrase: 'to taste',
      },
    ])

    const result = await loadPantry(birch, { days: 7 })

    expect(result.items[0]).toMatchObject({
      ingredient: { name: 'sool' },
      neededDisplayQuantity: 'maitse järgi',
      isVague: true,
    })
  })
})
