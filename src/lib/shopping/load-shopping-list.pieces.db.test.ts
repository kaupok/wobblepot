import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import type { PieceDisplay } from '@/generated/prisma/enums'
import { loadPlanShoppingList, loadShoppingList } from '@/lib/shopping/load-shopping-list'

// Vegetables a shopper picks one by one show as whole pieces on the shopping
// list, after the grams are summed across meals and the pantry is subtracted
// (HON-1312). Runs against PGlite with no mocks, as load-shopping-list.db.test.ts.

// Thursday 15 October 2026, noon in Tallinn.
const NOW = new Date('2026-10-15T09:00:00Z')
const PLAN_CREATED_AT = new Date('2026-10-10T08:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

async function ingredient(
  id: string,
  name: string,
  {
    gramsPerPiece = null,
    pieceDisplay = 'none',
    measuredByVolume = false,
  }: { gramsPerPiece?: number | null; pieceDisplay?: PieceDisplay; measuredByVolume?: boolean },
) {
  await prisma.ingredient.create({
    data: {
      id,
      name,
      category: 'vegetable',
      defaultUnit: 'g',
      gramsPerPiece,
      pieceDisplay,
      measuredByVolume,
      calories: 40,
      protein: 1,
      carbs: 9,
      fat: 0,
    },
  })
}

async function meal(id: string, components: [ingredientId: string, grams: number][]) {
  await prisma.meal.create({
    data: {
      id,
      name: id,
      components: {
        create: components.map(([ingredientId, quantityPerServing]) => ({
          ingredientId,
          quantityPerServing,
        })),
      },
    },
  })
}

async function household(locale = 'en') {
  return prisma.household.create({
    data: {
      id: 'alder',
      name: 'alder',
      locale,
      timezone: 'Europe/Tallinn',
      mealPlans: { create: { id: 'plan-alder', createdAt: PLAN_CREATED_AT } },
    },
  })
}

/** A dinner for one on `date` (YYYY-MM-DD), so stored grams are the grams needed. */
async function entry(date: string, mealId: string) {
  await prisma.mealPlanEntry.create({
    data: {
      planId: 'plan-alder',
      date: new Date(`${date}T00:00:00Z`),
      mealType: 'dinner',
      mealId,
      servingOverride: 1,
    },
  })
}

async function world() {
  await ingredient('ing-onion', 'onion', {
    gramsPerPiece: 110,
    pieceDisplay: 'recipe_and_shopping',
  })
  await ingredient('ing-garlic', 'garlic', {
    gramsPerPiece: 5,
    pieceDisplay: 'recipe_and_shopping',
  })
  await ingredient('ing-potato', 'potato', { gramsPerPiece: 150, pieceDisplay: 'recipe' })
  await ingredient('ing-paprika', 'paprika', {})
  await ingredient('ing-oil', 'vegetable oil', { measuredByVolume: true })
  await meal('meal-soup', [
    ['ing-onion', 83],
    ['ing-garlic', 8],
    ['ing-potato', 450],
    ['ing-paprika', 6],
    ['ing-oil', 11],
  ])
}

function displayById(list: {
  groups: { items: { ingredientId: string; displayQuantity: string }[] }[]
}) {
  return Object.fromEntries(
    list.groups.flatMap((g) => g.items).map((i) => [i.ingredientId, i.displayQuantity]),
  )
}

describe('shopping list vegetables in pieces', () => {
  it('rounds onion and garlic up to whole pieces and keeps potato, paprika and oil in their unit', async () => {
    await world()
    const alder = await household()
    await entry('2026-10-16', 'meal-soup')

    expect(displayById(await loadShoppingList(alder, { days: 7 }))).toEqual({
      'ing-onion': '1 pc',
      'ing-garlic': '2 pc',
      'ing-potato': '450g',
      'ing-paprika': '6g',
      'ing-oil': '11ml',
    })
  })

  it('sums the onion across two meals before rounding: 165 g is one line of 2 pc', async () => {
    await world()
    await meal('meal-stew', [['ing-onion', 82]])
    const alder = await household()
    await entry('2026-10-16', 'meal-soup')
    await entry('2026-10-17', 'meal-stew')

    const list = await loadPlanShoppingList(alder, 'plan-alder')
    const onions = list.groups.flatMap((g) => g.items).filter((i) => i.ingredientId === 'ing-onion')

    expect(onions).toHaveLength(1)
    expect(onions[0]).toMatchObject({ quantity: 165, displayQuantity: '2 pc' })
  })

  it('subtracts the pantry before rounding', async () => {
    await world()
    await meal('meal-stew', [['ing-onion', 82]])
    const alder = await household()
    await entry('2026-10-16', 'meal-soup')
    await entry('2026-10-17', 'meal-stew')
    await prisma.pantryItem.create({
      data: { householdId: 'alder', ingredientId: 'ing-onion', quantity: 100 },
    })

    expect(displayById(await loadShoppingList(alder, { days: 7 }))['ing-onion']).toBe('1 pc')
  })

  it('shows the Estonian piece label', async () => {
    await world()
    const alder = await household('et')
    await entry('2026-10-16', 'meal-soup')

    expect(displayById(await loadShoppingList(alder, { days: 7 }))['ing-onion']).toBe('1 tk')
  })
})
