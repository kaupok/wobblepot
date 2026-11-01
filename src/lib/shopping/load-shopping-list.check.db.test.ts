import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/lib/prisma'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

import { entry, household, ingredient, itemsById, NOW } from './load-shopping-list.fixtures'

// The "have some" needs to check before a shop (HON-1584). Runs on PGlite
// with no mocks, as load-shopping-list.db.test.ts does.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * An Estonian household, read on Thursday 15 October. A carrot soup for 2 on
 * 16 Oct (tomorrow) and 18 Oct needs 580 g carrot and 30 g olive oil each
 * time. A salad for 2 on 17 Oct needs 1 lemon's worth, 80 g.
 */
async function plan() {
  await ingredient('ing-test-carrot', 'carrot', 'vegetable', { et: 'porgand' })
  await ingredient('ing-test-oil', 'olive oil', 'fat', { et: 'oliiviõli' })
  await ingredient('ing-test-lemon', 'lemon', 'fruit', { et: 'sidrun' })
  await prisma.meal.create({
    data: {
      id: 'meal-test-soup',
      name: 'Carrot soup',
      components: {
        create: [
          { ingredientId: 'ing-test-carrot', quantityPerServing: 290 },
          { ingredientId: 'ing-test-oil', quantityPerServing: 15 },
        ],
      },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-test-salad',
      name: 'Salad',
      components: { create: [{ ingredientId: 'ing-test-lemon', quantityPerServing: 40 }] },
    },
  })
  const kask = await household('kask', 'et')
  await entry('plan-kask', '2026-10-16', 'meal-test-soup', 2)
  await entry('plan-kask', '2026-10-17', 'meal-test-salad', 2)
  await entry('plan-kask', '2026-10-18', 'meal-test-soup', 2)
  for (const ingredientId of ['ing-test-carrot', 'ing-test-oil', 'ing-test-lemon']) {
    await prisma.pantryItem.create({
      data: { householdId: 'kask', ingredientId, quantity: null },
    })
  }
  return { kask }
}

describe('loadShoppingList — check (HON-1584)', () => {
  it('lists a "have some" item two meals use, in Estonian, and not as a line to buy', async () => {
    const { kask } = await plan()

    const list = await loadShoppingList(kask, { days: 7 })

    expect(list.check).toEqual([
      {
        ingredientId: 'ing-test-carrot',
        name: 'porgand',
        quantity: 1160,
        displayUnit: 'g',
        displayQuantity: '1,2kg',
        mealCount: 2,
        neededByDate: '2026-10-16',
        neededByRelative: 'Homme',
        pantryRows: [{ id: expect.any(String), quantity: null }],
        isStaple: false,
      },
    ])
    expect(itemsById(list)).toEqual({})
  })
})
