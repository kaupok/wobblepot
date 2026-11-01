import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { updatePantryItem } from '@/lib/pantry/pantry-items'
import { prisma } from '@/lib/prisma'
import { loadPlanShoppingList, loadShoppingList } from '@/lib/shopping/load-shopping-list'

import { entry, household, ingredient, itemsById, NOW } from './load-shopping-list.fixtures'

// A row the household marked running low goes on the list (HON-1586). Runs
// against PGlite through the `unit-db` project, with no mocks, through both
// loaders. The low tap goes through `updatePantryItem`, as the app's does, so
// it bumps `updatedAt` after the plan was made: the case where the line would
// read as bought without the `lowAt` gate.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Alder, an Estonian household, read on Thursday 15 October:
 *
 * - Onions: have some, marked low. A soup for 1 on 17 Oct needs 150 g.
 * - Tahini: have some, marked low. Nothing planned needs it.
 * - Carrots: have some, not low. The soup needs 200 g.
 */
async function world() {
  await ingredient('ing-onion', 'onions', 'vegetable', { et: 'sibulad' })
  await ingredient('ing-tahini', 'tahini', 'condiment', { et: 'tahiini' })
  await ingredient('ing-carrot', 'carrots', 'vegetable', { et: 'porgandid' })
  await prisma.meal.create({
    data: {
      id: 'meal-soup',
      name: 'Soup',
      components: {
        create: [
          { ingredientId: 'ing-onion', quantityPerServing: 150 },
          { ingredientId: 'ing-carrot', quantityPerServing: 200 },
        ],
      },
    },
  })
  const alder = await household('alder', 'et')
  await entry('plan-alder', '2026-10-17', 'meal-soup', 1)
  for (const ingredientId of ['ing-onion', 'ing-tahini', 'ing-carrot']) {
    const row = await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId, quantity: null },
    })
    if (ingredientId !== 'ing-carrot') await updatePantryItem(alder, row.id, { low: true })
  }
  return { alder }
}

describe('a row marked running low', () => {
  it('lists a low "have some" row as not bought, with no amount, in Estonian', async () => {
    const { alder } = await world()

    const items = itemsById(await loadShoppingList(alder, { days: 7 }))

    // Carrots are at home and not low, so they have no line.
    expect(Object.keys(items).sort()).toEqual(['ing-onion', 'ing-tahini'])
    expect(items['ing-onion']).toMatchObject({
      name: 'sibulad',
      quantity: 0,
      displayQuantity: '',
      low: true,
      restock: false,
      purchased: false,
      neededByDate: '2026-10-17',
    })
    expect(items['ing-tahini']).toMatchObject({
      name: 'tahiini',
      quantity: 0,
      displayQuantity: '',
      mealCount: 0,
      low: true,
      purchased: false,
      neededByDate: '2026-10-15',
    })
  })

  it('follows the same rules in the per-plan list', async () => {
    const { alder } = await world()

    const items = itemsById(await loadPlanShoppingList(alder, 'plan-alder'))

    expect(items['ing-onion']).toMatchObject({
      name: 'sibulad',
      displayQuantity: '',
      low: true,
      purchased: false,
    })
    expect(items['ing-tahini']).toMatchObject({ displayQuantity: '', low: true, purchased: false })
  })
})
