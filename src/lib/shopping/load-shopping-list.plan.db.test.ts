import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { loadPlanShoppingList } from '@/lib/shopping/load-shopping-list'
import {
  NOW,
  PANTRY_UPDATED_AT,
  household,
  world,
  itemsById,
  refusalOf,
} from './load-shopping-list.fixtures'

// Runs against PGlite through the `unit-db` project, with no mocks: rows are
// written with Prisma and read through the loader (HON-1208). The route
// tests cover only how each route maps these answers. `next-intl/server` is
// the catalog shim, so the strings are the ones a household sees. The shared
// rows are in load-shopping-list.fixtures.ts.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadPlanShoppingList', () => {
  it('refuses an unknown plan as planNotFound', async () => {
    const { alder } = await world()

    expect(await refusalOf(loadPlanShoppingList(alder, 'plan-missing'))).toBe('planNotFound')
  })

  it("refuses another household's plan as otherHousehold", async () => {
    const { alder } = await world()
    await household('birch')

    expect(await refusalOf(loadPlanShoppingList(alder, 'plan-birch'))).toBe('otherHousehold')
  })

  it("lists the plan's items from today on, in the plan route's shape", async () => {
    const { alder } = await world()

    expect(await loadPlanShoppingList(alder, 'plan-alder')).toEqual({
      planId: 'plan-alder',
      generatedAt: '2026-10-10T08:00:00.000Z',
      groups: [
        {
          category: 'protein',
          categoryLabel: 'Proteins',
          items: [
            {
              ingredientId: 'ing-test-chicken',
              name: 'chicken thigh',
              // The stew on the 14th is before today, so it is left out.
              quantity: 900,
              unit: 'g',
              displayQuantity: '900g',
              mealCount: 2,
              purchased: false,
              neededByDate: '2026-10-16',
              neededByRelative: 'Tomorrow',
              neededByAbsolute: 'Oct 16',
              dueToday: false,
              isVague: false,
            },
          ],
        },
        {
          category: 'dairy',
          categoryLabel: 'Dairy',
          items: [
            {
              ingredientId: 'ing-test-milk',
              name: 'oat milk',
              quantity: 1500,
              unit: 'g',
              displayQuantity: '1.5l',
              mealCount: 1,
              purchased: false,
              neededByDate: '2026-10-15',
              neededByRelative: 'Today',
              neededByAbsolute: 'Oct 15',
              dueToday: true,
              isVague: false,
            },
          ],
        },
        {
          category: 'carb',
          categoryLabel: 'Carbs & grains',
          items: [
            {
              ingredientId: 'ing-test-rice',
              name: 'basmati rice',
              quantity: 1500,
              unit: 'g',
              displayQuantity: '1.5kg',
              mealCount: 1,
              purchased: false,
              neededByDate: '2026-10-15',
              neededByRelative: 'Today',
              neededByAbsolute: 'Oct 15',
              dueToday: true,
              isVague: false,
            },
          ],
        },
        {
          category: 'spice',
          categoryLabel: 'Spices & seasonings',
          items: [
            {
              ingredientId: 'ing-test-salt',
              name: 'sea salt',
              quantity: 4,
              unit: 'g',
              displayQuantity: 'to taste',
              mealCount: 1,
              purchased: false,
              neededByDate: '2026-10-15',
              neededByRelative: 'Today',
              neededByAbsolute: 'Oct 15',
              dueToday: true,
              isVague: true,
            },
            {
              ingredientId: 'ing-test-pepper',
              name: 'black pepper',
              quantity: 6,
              unit: 'g',
              displayQuantity: '6g',
              mealCount: 2,
              purchased: false,
              neededByDate: '2026-10-16',
              neededByRelative: 'Tomorrow',
              neededByAbsolute: 'Oct 16',
              dueToday: false,
              // The stored flag, even with no phrase to show.
              isVague: true,
            },
          ],
        },
      ],
      summary: { totalItems: 5, purchasedItems: 0, remainingItems: 5 },
    })
  })

  it("names, measures and dates the items in an Estonian household's language", async () => {
    const { alder } = await world({ locale: 'et' })

    const items = itemsById(await loadPlanShoppingList(alder, 'plan-alder'))

    expect(items['ing-test-rice']).toMatchObject({
      name: 'basmatiriis',
      displayQuantity: '1,5kg',
      neededByRelative: 'Täna',
      neededByAbsolute: '15. okt',
    })
    expect(items['ing-test-salt']).toMatchObject({ displayQuantity: 'maitse järgi' })
  })

  it('lists the amount still needed above a pantry quantity', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: {
        householdId: 'alder',
        ingredientId: 'ing-test-chicken',
        quantity: 400,
        updatedAt: PANTRY_UPDATED_AT,
      },
    })

    const list = await loadPlanShoppingList(alder, 'plan-alder')

    expect(itemsById(list)['ing-test-chicken']).toMatchObject({
      quantity: 500,
      displayQuantity: '500g',
      purchased: false,
    })
  })
})
