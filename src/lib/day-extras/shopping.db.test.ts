import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/lib/prisma'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

import { createDayExtra } from './day-extras'

// Day extras on the household's shopping list (HON-1309), against PGlite
// through the `unit-db` project, with no mocks. `next-intl/server` is the
// catalog shim, so the strings are the ones a household sees.

// Thursday 15 October 2026, noon in Tallinn: Saturday is 17 October.
const NOW = new Date('2026-10-15T09:00:00Z')
const SATURDAY = '2026-10-17'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

async function ingredient(id: string, name: string, measuredByVolume = false) {
  await prisma.ingredient.create({
    data: {
      id,
      name,
      category: 'condiment',
      defaultUnit: 'g',
      measuredByVolume,
      calories: 100,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  })
}

/** Alder, with no plan: one member, in Tallinn. Red wine and olive oil are global. */
async function world() {
  await ingredient('ing-wine', 'Red wine', true)
  await ingredient('ing-oil', 'Olive oil', true)
  return prisma.household.create({
    data: {
      id: 'hh-alder',
      name: 'Alder',
      locale: 'en',
      timezone: 'Europe/Tallinn',
      members: { create: [{ name: 'A' }] },
    },
  })
}

/** A plan with one dinner on `date` that needs 30 g olive oil per serving, for one. */
async function planOilDinner(householdId: string, date: string) {
  await prisma.meal.create({
    data: {
      id: 'meal-salad',
      name: 'Salad',
      components: { create: [{ ingredientId: 'ing-oil', quantityPerServing: 30 }] },
    },
  })
  await prisma.mealPlan.create({
    data: {
      id: 'plan-alder',
      householdId,
      entries: {
        create: { date: new Date(`${date}T00:00:00Z`), mealType: 'dinner', mealId: 'meal-salad' },
      },
    },
  })
}

const items = (list: Awaited<ReturnType<typeof loadShoppingList>>) =>
  list.groups.flatMap((g) => g.items)

describe('an ingredient extra on the shopping list', () => {
  it("puts red wine with its amount on Saturday's line, with no plan", async () => {
    const alder = await world()
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-wine', quantity: 750 })

    const list = await loadShoppingList(alder, { days: 7 })

    expect(items(list)).toEqual([
      expect.objectContaining({
        ingredientId: 'ing-wine',
        name: 'Red wine',
        displayQuantity: '750ml',
        neededByDate: SATURDAY,
        isVague: false,
      }),
    ])
  })

  it("merges with a planned meal's need for the same ingredient into one line", async () => {
    const alder = await world()
    await planOilDinner(alder.id, '2026-10-16')
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-oil', quantity: 100 })

    const oil = items(await loadShoppingList(alder, { days: 7 })).filter(
      (i) => i.ingredientId === 'ing-oil',
    )

    expect(oil).toEqual([
      expect.objectContaining({ displayQuantity: '130ml', neededByDate: '2026-10-16' }),
    ])
  })

  it('gives a line with no amount when the extra has none', async () => {
    const alder = await world()
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-wine' })

    expect(items(await loadShoppingList(alder, { days: 7 }))).toEqual([
      expect.objectContaining({ ingredientId: 'ing-wine', displayQuantity: 'some', isVague: true }),
    ])
  })

  // A staple at 0 (ran out) does get a line (HON-1398): load-shopping-list.restock.db.test.ts.
  it('adds no line when the pantry item is a staple the household has', async () => {
    const alder = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-wine', isStaple: true, quantity: null },
    })
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-wine', quantity: 750 })
    // Olive oil is not in the pantry, so its line shows the extras do reach the list.
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-oil', quantity: 100 })

    expect(items(await loadShoppingList(alder, { days: 7 })).map((i) => i.ingredientId)).toEqual([
      'ing-oil',
    ])
  })

  it('adds no line when the pantry item is marked "have some"', async () => {
    const alder = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-wine', quantity: null },
    })
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-wine' })
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-wine', quantity: 750 })
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-oil' })

    expect(items(await loadShoppingList(alder, { days: 7 })).map((i) => i.ingredientId)).toEqual([
      'ing-oil',
    ])
  })

  it('subtracts a known pantry quantity', async () => {
    const alder = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-wine', quantity: 250 },
    })
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-wine', quantity: 750 })

    expect(items(await loadShoppingList(alder, { days: 7 }))).toEqual([
      expect.objectContaining({ ingredientId: 'ing-wine', displayQuantity: '500ml' }),
    ])
  })

  it('stays off a window that ends before its day', async () => {
    const alder = await world()
    await createDayExtra(alder, { date: '2026-10-25', ingredientId: 'ing-wine', quantity: 750 })

    expect(items(await loadShoppingList(alder, { days: 7 }))).toEqual([])
    expect(items(await loadShoppingList(alder, { days: 14 }))).toHaveLength(1)
  })
})

describe('a window that holds only extras', () => {
  it('reads as a plan, so the list shows and a purchase can be dated', async () => {
    const alder = await world()
    await createDayExtra(alder, { date: SATURDAY, ingredientId: 'ing-wine', quantity: 750 })

    const list = await loadShoppingList(alder, { days: 7 })

    expect(list.hasAnyPlan).toBe(true)
    expect(list.generatedAt).toBe(NOW.toISOString())
  })

  it('reads as a plan with only a free-text extra, which adds no line', async () => {
    const alder = await world()
    await createDayExtra(alder, { date: SATURDAY, label: 'chips' })

    const list = await loadShoppingList(alder, { days: 7 })

    expect(list.hasAnyPlan).toBe(true)
    expect(items(list)).toEqual([])
    expect(list.customItems.map((i) => i.name)).toEqual(['chips'])
  })

  it('reads as no plan once its only extra has passed', async () => {
    const alder = await world()
    await prisma.dayExtra.create({
      data: {
        householdId: alder.id,
        date: new Date('2026-10-14T00:00:00Z'),
        ingredientId: 'ing-wine',
        quantity: 750,
        position: 0,
      },
    })

    const list = await loadShoppingList(alder, { days: 7 })

    expect(list.hasAnyPlan).toBe(false)
    expect(items(list)).toEqual([])
  })
})
