import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/lib/prisma'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

import { entry, household, ingredient, itemsById, NOW } from './load-shopping-list.fixtures'

// The needs the pantry covers, for Today's "At home" tab (HON-1578). Runs on
// PGlite with no mocks, as load-shopping-list.db.test.ts does.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

async function stock(
  householdId: string,
  ingredientId: string,
  quantity: number | null,
  isStaple = false,
) {
  const row = await prisma.pantryItem.create({
    data: { householdId, ingredientId, quantity, isStaple },
  })
  return row.id
}

/**
 * Today (15 October) a dinner for 4 needs 1500 g rice, 8 g salt, 600 g
 * chicken, 1500 g oat milk and 20 g basil.
 */
async function plan() {
  await ingredient('ing-test-rice', 'basmati rice', 'carb')
  await ingredient('ing-test-salt', 'sea salt', 'spice')
  await ingredient('ing-test-chicken', 'chicken thigh', 'protein')
  await ingredient('ing-test-milk', 'oat milk', 'dairy')
  // The global catalogue names the cover table reads: fresh basil covers basil.
  await ingredient('ing-basil', 'basil', 'spice')
  await ingredient('ing-fresh-basil', 'fresh basil', 'spice')
  await prisma.meal.create({
    data: {
      id: 'meal-test-dinner',
      name: 'Dinner',
      components: {
        create: [
          { ingredientId: 'ing-test-rice', quantityPerServing: 375 },
          { ingredientId: 'ing-test-salt', quantityPerServing: 2 },
          { ingredientId: 'ing-test-chicken', quantityPerServing: 150 },
          { ingredientId: 'ing-test-milk', quantityPerServing: 375 },
          { ingredientId: 'ing-basil', quantityPerServing: 5 },
        ],
      },
    },
  })
  const alder = await household('alder')
  await entry('plan-alder', '2026-10-15', 'meal-test-dinner', 4)
  return alder
}

describe('loadShoppingList — at home (HON-1578)', () => {
  it('lists the needs the pantry covers, each with the row that covers it', async () => {
    const alder = await plan()
    const rice = await stock(alder.id, 'ing-test-rice', null)
    const salt = await stock(alder.id, 'ing-test-salt', 5, true)
    const chicken = await stock(alder.id, 'ing-test-chicken', 200)
    await stock(alder.id, 'ing-test-milk', 0)
    const freshBasil = await stock(alder.id, 'ing-fresh-basil', null)

    const list = await loadShoppingList(alder, { days: 7 })

    expect(Object.fromEntries(list.atHome.map((item) => [item.ingredientId, item]))).toEqual({
      // "Have some": the full need
      'ing-test-rice': {
        ingredientId: 'ing-test-rice',
        name: 'basmati rice',
        displayQuantity: '1.5kg',
        neededByDate: '2026-10-15',
        pantryRows: [{ id: rice, quantity: null }],
        isStaple: false,
      },
      // A staple not at 0
      'ing-test-salt': {
        ingredientId: 'ing-test-salt',
        name: 'sea salt',
        displayQuantity: '8g',
        neededByDate: '2026-10-15',
        pantryRows: [{ id: salt, quantity: 5 }],
        isStaple: true,
      },
      // 200 g of 600 g: what the pantry holds
      'ing-test-chicken': {
        ingredientId: 'ing-test-chicken',
        name: 'chicken thigh',
        displayQuantity: '200g',
        neededByDate: '2026-10-15',
        pantryRows: [{ id: chicken, quantity: 200 }],
        isStaple: false,
      },
      // Covered by the fresh basil row, which the switch acts on
      'ing-basil': {
        ingredientId: 'ing-basil',
        name: 'basil',
        displayQuantity: '20g',
        neededByDate: '2026-10-15',
        pantryRows: [{ id: freshBasil, quantity: null }],
        isStaple: false,
      },
    })

    // The partial amount is on both lists; the row at 0 only on To buy.
    const toBuy = itemsById(list)
    expect(Object.keys(toBuy).sort()).toEqual(['ing-test-chicken', 'ing-test-milk'])
    expect(toBuy['ing-test-chicken']?.displayQuantity).toBe('400g')
    expect(toBuy['ing-test-milk']).toMatchObject({ displayQuantity: '1.5kg', ranOut: true })
    expect(toBuy['ing-test-chicken']?.ranOut).toBe(false)
  })

  it('lists nothing at home with an empty pantry', async () => {
    const alder = await plan()

    expect((await loadShoppingList(alder, { days: 7 })).atHome).toEqual([])
  })
})
