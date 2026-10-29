import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/lib/prisma'
import { loadPlanShoppingList, loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { purchaseIngredients, unpurchaseIngredient } from '@/lib/shopping/purchase'

import { entry, household, ingredient, itemsById, NOW } from './load-shopping-list.fixtures'

// A staple the household marked ran out goes on the list (HON-1398). Runs
// against PGlite through the `unit-db` project, with no mocks, through both
// loaders, so both list builders and the line display are covered.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Alder, read on Thursday 15 October:
 *
 * - Eggs: staple, ran out. An omelette for 1 on 17 Oct needs 300 g.
 * - Greek yoghurt: staple, ran out. Nothing planned needs it.
 * - Green beans: staple, ran out. A day extra of 200 g on 16 Oct.
 * - Sea salt: staple, have some. The omelette needs 2 g.
 * - Black pepper: staple, have some. Nothing needs it.
 * - Basmati rice: not a staple, ran out. Nothing needs it.
 */
async function world(locale = 'en') {
  await ingredient('ing-eggs', 'eggs', 'dairy', { et: 'munad' })
  await ingredient('ing-yoghurt', 'Greek yoghurt', 'dairy', { et: 'Kreeka jogurt' })
  await ingredient('ing-beans', 'green beans', 'legume')
  await ingredient('ing-salt', 'sea salt', 'spice')
  await ingredient('ing-pepper', 'black pepper', 'spice')
  await ingredient('ing-rice', 'basmati rice', 'carb')
  await prisma.meal.create({
    data: {
      id: 'meal-omelette',
      name: 'Omelette',
      components: {
        create: [
          { ingredientId: 'ing-eggs', quantityPerServing: 300 },
          { ingredientId: 'ing-salt', quantityPerServing: 2 },
        ],
      },
    },
  })
  const alder = await household('alder', locale)
  await entry('plan-alder', '2026-10-17', 'meal-omelette', 1)
  await prisma.dayExtra.create({
    data: {
      householdId: alder.id,
      date: new Date('2026-10-16T00:00:00Z'),
      ingredientId: 'ing-beans',
      quantity: 200,
      position: 0,
    },
  })
  const pantry = (ingredientId: string, quantity: number | null, isStaple: boolean) =>
    prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId, quantity, isStaple },
    })
  await pantry('ing-eggs', 0, true)
  await pantry('ing-yoghurt', 0, true)
  await pantry('ing-beans', 0, true)
  await pantry('ing-salt', null, true)
  await pantry('ing-pepper', null, true)
  await pantry('ing-rice', 0, false)
  return { alder }
}

describe('a staple marked ran out, in the rolling-window list', () => {
  it('lists only the ran-out staples, each needed today and marked restock', async () => {
    const { alder } = await world()

    const items = itemsById(await loadShoppingList(alder, { days: 7 }))

    // No line for the staples at null (salt, pepper) or the ordinary rice at 0.
    expect(Object.keys(items).sort()).toEqual(['ing-beans', 'ing-eggs', 'ing-yoghurt'])
  })

  it('gives a staple nothing planned needs one line with no amount', async () => {
    const { alder } = await world()

    const list = await loadShoppingList(alder, { days: 7 })

    expect(itemsById(list)['ing-yoghurt']).toMatchObject({
      name: 'Greek yoghurt',
      quantity: 0,
      displayQuantity: '',
      pantryDisplayQuantity: '',
      mealCount: 0,
      restock: true,
      purchased: false,
      neededByDate: '2026-10-15',
      dueToday: true,
    })
    // In its own category: yoghurt under Dairy.
    expect(
      list.groups.find((g) => g.category === 'dairy')?.items.map((i) => i.ingredientId),
    ).toContain('ing-yoghurt')
  })

  it('gives a staple a planned meal needs the 300 g, needed today', async () => {
    const { alder } = await world()

    expect(itemsById(await loadShoppingList(alder, { days: 7 }))['ing-eggs']).toMatchObject({
      quantity: 300,
      displayQuantity: '300g',
      restock: true,
      neededByDate: '2026-10-15',
    })
  })

  it("gives a staple a day extra needs the extra's 200 g", async () => {
    const { alder } = await world()

    expect(itemsById(await loadShoppingList(alder, { days: 7 }))['ing-beans']).toMatchObject({
      quantity: 200,
      displayQuantity: '200g',
      restock: true,
      neededByDate: '2026-10-15',
    })
  })

  it('names a line with no amount in the household language', async () => {
    const { alder } = await world('et')

    expect(itemsById(await loadShoppingList(alder, { days: 7 }))['ing-yoghurt']).toMatchObject({
      name: 'Kreeka jogurt',
      displayQuantity: '',
    })
  })

  it('takes the line off when bought, and puts it back when the purchase is undone', async () => {
    const { alder } = await world()

    await purchaseIngredients(alder, ['ing-yoghurt'])

    expect(itemsById(await loadShoppingList(alder, { days: 7 }))['ing-yoghurt']).toBeUndefined()
    expect(
      await prisma.pantryItem.findUnique({
        where: { householdId_ingredientId: { householdId: alder.id, ingredientId: 'ing-yoghurt' } },
        select: { quantity: true, isStaple: true },
      }),
    ).toEqual({ quantity: null, isStaple: true })

    expect(await unpurchaseIngredient(alder.id, 'ing-yoghurt')).toBe('ran_out')

    expect(itemsById(await loadShoppingList(alder, { days: 7 }))['ing-yoghurt']).toMatchObject({
      quantity: 0,
      restock: true,
    })
  })

  it('marks an ordinary line restock false', async () => {
    const { alder } = await world()
    await prisma.pantryItem.update({
      where: { householdId_ingredientId: { householdId: alder.id, ingredientId: 'ing-eggs' } },
      data: { isStaple: false },
    })

    expect(itemsById(await loadShoppingList(alder, { days: 7 }))['ing-eggs']).toMatchObject({
      quantity: 300,
      restock: false,
      neededByDate: '2026-10-17',
    })
  })
})

describe('a staple marked ran out, in the per-plan list', () => {
  it('follows the same rules', async () => {
    const { alder } = await world()

    const items = itemsById(await loadPlanShoppingList(alder, 'plan-alder'))

    // The per-plan list has no extras, so the beans have no planned need either.
    expect(Object.keys(items).sort()).toEqual(['ing-beans', 'ing-eggs', 'ing-yoghurt'])
    expect(items['ing-eggs']).toMatchObject({
      quantity: 300,
      displayQuantity: '300g',
      restock: true,
      neededByDate: '2026-10-15',
    })
    expect(items['ing-yoghurt']).toMatchObject({
      quantity: 0,
      displayQuantity: '',
      mealCount: 0,
      restock: true,
      neededByDate: '2026-10-15',
    })
  })
})
