import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  loadPlanShoppingList,
  loadShoppingList,
  ShoppingPlanError,
  type ShoppingPlanRefusal,
} from '@/lib/shopping/load-shopping-list'

// Runs against PGlite through the `unit-db` project, with no mocks: rows are
// written with Prisma and read through the two loaders (HON-1208). The route
// tests cover only how each route maps these answers. `next-intl/server` is
// the catalog shim, so the strings are the ones a household sees.

// Thursday 15 October 2026, noon in Tallinn. Only `Date` is faked, so "today"
// and the relative labels are fixed and PGlite's timers still run.
const NOW = new Date('2026-10-15T09:00:00Z')
const PLAN_CREATED_AT = new Date('2026-10-10T08:00:00Z')
// After the plan was created, so a "have some" here would read as a purchase
// if the item stayed on the list.
const PANTRY_UPDATED_AT = new Date('2026-10-14T12:00:00Z')

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
  category: 'protein' | 'carb' | 'dairy' | 'spice' | 'legume',
  { et, measuredByVolume = false }: { et?: string; measuredByVolume?: boolean } = {},
) {
  await prisma.ingredient.create({
    data: {
      id,
      name,
      category,
      defaultUnit: 'g',
      measuredByVolume,
      calories: 100,
      protein: 10,
      carbs: 10,
      fat: 1,
      ...(et ? { translations: { create: { locale: 'et', name: et } } } : {}),
    },
  })
}

async function household(id: string, locale = 'en') {
  return prisma.household.create({
    data: {
      id,
      name: id,
      locale,
      timezone: 'Europe/Tallinn',
      mealPlans: { create: { id: `plan-${id}`, createdAt: PLAN_CREATED_AT } },
    },
  })
}

/** A planned entry on `date` (YYYY-MM-DD) cooking `mealId` for `servings`. */
async function entry(planId: string, date: string, mealId: string, servings: number) {
  await prisma.mealPlanEntry.create({
    data: {
      planId,
      date: new Date(`${date}T00:00:00Z`),
      mealType: 'dinner',
      mealId,
      servingOverride: servings,
    },
  })
}

/**
 * Alder's plan, read on 15 October:
 *
 * - 14 Oct (yesterday): stew for 4, which no list may count.
 * - 15 Oct (today): bowl for 4, so 1500 g rice, 1500 g oat milk (measured by
 *   volume) and salt "to taste".
 * - 16 Oct (tomorrow) and 18 Oct: stew for 4 and 2, so 900 g chicken and 6 g
 *   pepper. The pepper is vague with no phrase, so it shows as an amount.
 *
 * Rice, milk and chicken carry Estonian names.
 */
async function world({ locale = 'en' }: { locale?: string } = {}) {
  await ingredient('ing-test-chicken', 'chicken thigh', 'protein', { et: 'kanakints' })
  await ingredient('ing-test-rice', 'basmati rice', 'carb', { et: 'basmatiriis' })
  await ingredient('ing-test-milk', 'oat milk', 'dairy', {
    et: 'kaerajook',
    measuredByVolume: true,
  })
  await ingredient('ing-test-salt', 'sea salt', 'spice')
  await ingredient('ing-test-pepper', 'black pepper', 'spice')
  await prisma.meal.create({
    data: {
      id: 'meal-test-stew',
      name: 'Chicken stew',
      components: {
        create: [
          { ingredientId: 'ing-test-chicken', quantityPerServing: 150 },
          { ingredientId: 'ing-test-pepper', quantityPerServing: 1, isVague: true },
        ],
      },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-test-bowl',
      name: 'Rice bowl',
      components: {
        create: [
          { ingredientId: 'ing-test-rice', quantityPerServing: 375 },
          { ingredientId: 'ing-test-milk', quantityPerServing: 375 },
          {
            ingredientId: 'ing-test-salt',
            quantityPerServing: 1,
            isVague: true,
            originalPhrase: 'to taste',
          },
        ],
      },
    },
  })
  const alder = await household('alder', locale)
  await entry('plan-alder', '2026-10-14', 'meal-test-stew', 4)
  await entry('plan-alder', '2026-10-15', 'meal-test-bowl', 4)
  await entry('plan-alder', '2026-10-16', 'meal-test-stew', 4)
  await entry('plan-alder', '2026-10-18', 'meal-test-stew', 2)
  return { alder }
}

/** The listed items across every group, by ingredient id. */
function itemsById<T extends { ingredientId: string }>(list: { groups: { items: T[] }[] }) {
  return Object.fromEntries(list.groups.flatMap((g) => g.items).map((i) => [i.ingredientId, i]))
}

async function refusalOf(promise: Promise<unknown>): Promise<ShoppingPlanRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ShoppingPlanError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

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
              displayUnit: 'g',
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
              displayUnit: 'ml',
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
              displayUnit: 'g',
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
              displayUnit: 'g',
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
              displayUnit: 'g',
              // Vague with no phrase shows the amount, so it is not vague
              // here (HON-783).
              displayQuantity: '6g',
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
    ['a staple', { quantity: 0, isStaple: true }],
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
      },
      {
        id: 'custom-soap',
        name: 'Dish soap',
        checked: false,
        ingredientId: null,
        ingredientCategory: null,
        createdAt: '2026-10-12T10:00:00.000Z',
      },
    ])
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
