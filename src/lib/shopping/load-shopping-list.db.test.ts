import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/lib/prisma'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

import {
  entry,
  household,
  ingredient,
  itemsById,
  NOW,
  PANTRY_UPDATED_AT,
  world,
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

describe('loadShoppingList', () => {
  it('returns an empty list for a household with no plan', async () => {
    const alder = await prisma.household.create({
      data: { id: 'alder', name: 'Alder', timezone: 'Europe/Tallinn' },
    })

    expect(await loadShoppingList(alder, { days: 7 })).toEqual({
      windowDays: 7,
      startDate: '2026-10-15',
      endDate: '2026-10-21',
      generatedAt: null,
      hasAnyPlan: false,
      groups: [],
      customItems: [],
      atHome: [],
      check: [],
      summary: { totalItems: 0, purchasedItems: 0, remainingItems: 0 },
    })
  })

  // HON-653: an entry past the window leaves `generatedAt` null, which must
  // not read as "no plan".
  it('reports a plan whose only entry is past the window', async () => {
    await world()
    const birch = await household('birch')
    await entry('plan-birch', '2026-10-30', 'meal-test-stew', 4)

    const list = await loadShoppingList(birch, { days: 7 })

    expect(list).toMatchObject({ generatedAt: null, hasAnyPlan: true, groups: [] })
  })

  it("lists the window's items from today on, in category order, in English", async () => {
    const { alder } = await world()

    expect(await loadShoppingList(alder, { days: 7 })).toEqual({
      windowDays: 7,
      startDate: '2026-10-15',
      endDate: '2026-10-21',
      generatedAt: '2026-10-10T08:00:00.000Z',
      hasAnyPlan: true,
      groups: [
        {
          category: 'protein',
          categoryLabel: 'Proteins',
          items: [
            {
              ingredientId: 'ing-test-chicken',
              name: 'chicken thigh',
              // 150 g × 4 on the 16th and × 2 on the 18th; the 14th is past.
              quantity: 900,
              unit: 'g',
              restock: false,
              ranOut: false,
              low: false,
              displayUnit: 'g',
              displayQuantity: '900g',
              pantryDisplayQuantity: '900g',
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
              restock: false,
              ranOut: false,
              low: false,
              displayUnit: 'ml',
              displayQuantity: '1.5l',
              pantryDisplayQuantity: '1.5l',
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
              restock: false,
              ranOut: false,
              low: false,
              displayUnit: 'g',
              displayQuantity: '1.5kg',
              pantryDisplayQuantity: '1.5kg',
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
              restock: false,
              ranOut: false,
              low: false,
              displayUnit: 'g',
              displayQuantity: 'to taste',
              pantryDisplayQuantity: 'to taste',
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
              restock: false,
              ranOut: false,
              low: false,
              displayUnit: 'g',
              // Vague with no phrase shows the amount, so it is not vague
              // here (HON-783).
              displayQuantity: '6g',
              pantryDisplayQuantity: '6g',
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
      ],
      customItems: [],
      atHome: [],
      check: [],
      summary: { totalItems: 5, purchasedItems: 0, remainingItems: 5 },
    })
  })

  it.each([
    // Ran out, set after the plan was created (HON-1201): the full amount.
    { pantry: { quantity: 0 }, quantity: 900, displayQuantity: '900g' },
    // 400 g at home, set after the plan was created (HON-1176): the other 500 g.
    { pantry: { quantity: 400 }, quantity: 500, displayQuantity: '500g' },
  ])(
    'lists $quantity g of chicken with a pantry quantity of $pantry.quantity, not purchased',
    async ({ pantry, quantity, displayQuantity }) => {
      const { alder } = await world()
      await prisma.pantryItem.create({
        data: {
          householdId: 'alder',
          ingredientId: 'ing-test-chicken',
          updatedAt: PANTRY_UPDATED_AT,
          ...pantry,
        },
      })

      const list = await loadShoppingList(alder, { days: 7 })

      expect(itemsById(list)['ing-test-chicken']).toMatchObject({
        quantity,
        displayQuantity,
        purchased: false,
      })
      expect(list.summary).toEqual({ totalItems: 5, purchasedItems: 0, remainingItems: 5 })
    },
  )

  it.each([
    ['"have some"', { quantity: null }],
    // A staple at 0 (ran out) stays on the list (HON-1398): load-shopping-list.restock.db.test.ts.
    ['a staple', { quantity: null, isStaple: true }],
  ])('drops chicken marked %s in the pantry', async (_label, pantry) => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: {
        householdId: 'alder',
        ingredientId: 'ing-test-chicken',
        updatedAt: PANTRY_UPDATED_AT,
        ...pantry,
      },
    })

    const list = await loadShoppingList(alder, { days: 7 })

    expect(list.groups.map((g) => g.category)).toEqual(['dairy', 'carb', 'spice'])
    expect(list.summary).toEqual({ totalItems: 4, purchasedItems: 0, remainingItems: 4 })
  })

  it("names, measures and dates the items in an Estonian household's language", async () => {
    const { alder } = await world({ locale: 'et' })

    const items = itemsById(await loadShoppingList(alder, { days: 7 }))

    expect(items['ing-test-chicken']).toMatchObject({
      name: 'kanakints',
      displayQuantity: '900g',
      neededByRelative: 'Homme',
      neededByAbsolute: '16. okt',
    })
    expect(items['ing-test-rice']).toMatchObject({
      name: 'basmatiriis',
      displayQuantity: '1,5kg',
      neededByRelative: 'Täna',
    })
    expect(items['ing-test-milk']).toMatchObject({
      name: 'kaerajook',
      displayUnit: 'ml',
      displayQuantity: '1,5l',
    })
    expect(items['ing-test-salt']).toMatchObject({
      displayQuantity: 'maitse järgi',
      isVague: true,
    })
  })

  it('lists custom items newest first, with the linked ingredient category', async () => {
    const { alder } = await world()
    await prisma.customShoppingItem.create({
      data: {
        id: 'custom-soap',
        householdId: 'alder',
        name: 'Dish soap',
        createdAt: new Date('2026-10-12T10:00:00Z'),
      },
    })
    await prisma.customShoppingItem.create({
      data: {
        id: 'custom-milk',
        householdId: 'alder',
        name: 'Extra oat milk',
        ingredientId: 'ing-test-milk',
        checked: true,
        createdAt: new Date('2026-10-13T10:00:00Z'),
      },
    })

    const list = await loadShoppingList(alder, { days: 7 })

    expect(list.customItems).toEqual([
      {
        id: 'custom-milk',
        name: 'Extra oat milk',
        checked: true,
        ingredientId: 'ing-test-milk',
        ingredientCategory: 'dairy',
        createdAt: '2026-10-13T10:00:00.000Z',
        neededBy: null,
      },
      {
        id: 'custom-soap',
        name: 'Dish soap',
        checked: false,
        ingredientId: null,
        ingredientCategory: null,
        createdAt: '2026-10-12T10:00:00.000Z',
        neededBy: null,
      },
    ])
  })

  // HON-1310: a manual item a free-text extra links to is dated by the
  // earliest linked extra from today on, in the household's timezone.
  it('dates a linked manual item by its earliest extra from today on', async () => {
    const { alder } = await world()
    const linkedItem = async (name: string, dates: string[]) => {
      const item = await prisma.customShoppingItem.create({ data: { householdId: 'alder', name } })
      for (const [position, date] of dates.entries()) {
        await prisma.dayExtra.create({
          data: {
            householdId: 'alder',
            date: new Date(`${date}T00:00:00Z`),
            label: name,
            position,
            customShoppingItemId: item.id,
          },
        })
      }
    }
    await linkedItem('chips', ['2026-10-14', '2026-10-20', '2026-10-17'])
    await linkedItem('cake', ['2026-10-14', '2026-10-15'])
    await linkedItem('nuts', ['2026-10-13'])
    await prisma.customShoppingItem.create({ data: { householdId: 'alder', name: 'soap' } })

    const list = await loadShoppingList(alder, { days: 7 })

    expect(Object.fromEntries(list.customItems.map((c) => [c.name, c.neededBy]))).toEqual({
      chips: '2026-10-17',
      cake: '2026-10-15',
      nuts: null,
      soap: null,
    })
  })

  it('counts an entry 10 days out in the 14-day window only', async () => {
    const { alder } = await world()
    await entry('plan-alder', '2026-10-25', 'meal-test-stew', 4)

    const week = await loadShoppingList(alder, { days: 7 })
    const fortnight = await loadShoppingList(alder, { days: 14 })

    expect(week).toMatchObject({ windowDays: 7, endDate: '2026-10-21' })
    expect(itemsById(week)['ing-test-chicken']).toMatchObject({ quantity: 900, mealCount: 2 })
    expect(fortnight).toMatchObject({ windowDays: 14, endDate: '2026-10-28' })
    expect(itemsById(fortnight)['ing-test-chicken']).toMatchObject({ quantity: 1500, mealCount: 3 })
  })

  it("never shows another household's entries, pantry or custom items", async () => {
    const { alder } = await world()
    await ingredient('ing-test-lentils', 'red lentils', 'legume')
    await prisma.meal.create({
      data: {
        id: 'meal-test-dal',
        name: 'Dal',
        components: { create: { ingredientId: 'ing-test-lentils', quantityPerServing: 80 } },
      },
    })
    const birch = await household('birch')
    await entry('plan-birch', '2026-10-16', 'meal-test-dal', 2)
    // Birch has chicken at home; Alder still has to buy it.
    await prisma.pantryItem.create({
      data: { householdId: 'birch', ingredientId: 'ing-test-chicken', quantity: null },
    })
    await prisma.customShoppingItem.create({ data: { householdId: 'birch', name: 'Birch soap' } })

    const alderList = await loadShoppingList(alder, { days: 7 })
    const birchList = await loadShoppingList(birch, { days: 7 })

    expect(Object.keys(itemsById(alderList)).sort()).toEqual([
      'ing-test-chicken',
      'ing-test-milk',
      'ing-test-pepper',
      'ing-test-rice',
      'ing-test-salt',
    ])
    expect(itemsById(alderList)['ing-test-chicken']).toMatchObject({ quantity: 900 })
    expect(alderList.customItems).toEqual([])
    expect(Object.keys(itemsById(birchList))).toEqual(['ing-test-lentils'])
    expect(birchList.customItems.map((c) => c.name)).toEqual(['Birch soap'])
  })
})
