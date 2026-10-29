import { describe, expect, it } from 'vitest'

import { addEntryChange } from '@/lib/meal-plans/entry-changes'
import { prisma } from '@/lib/prisma'

import { getStartOfTodayInTimezone } from './dates'
import { computeRollingWindowShoppingList, computeShoppingList } from './shopping-list'

// The shopping list with an entry's own ingredient changes (HON-1243). Runs
// against PGlite through the `unit-db` project, with no mocks.

const TZ = 'Europe/Tallinn'

/**
 * Alder: three adults, so 3 servings. A cream pasta is planned for dinner the
 * day after tomorrow, and again the day after. The pasta is 100 g pasta and
 * 50 g cream per serving. Birch plans the same meal.
 */
async function world() {
  for (const id of ['pasta', 'cream', 'yoghurt', 'chili']) {
    await prisma.ingredient.create({
      data: {
        id,
        name: id,
        category: 'dairy',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  }
  const household = (name: string, planId: string, members: number) =>
    prisma.household.create({
      data: {
        name,
        members: { create: Array.from({ length: members }, (_, i) => ({ name: `M${i}` })) },
        mealPlans: { create: { id: planId } },
      },
    })
  const alder = await household('Alder', 'plan-alder', 3)
  const birch = await household('Birch', 'plan-birch', 1)
  await prisma.meal.create({
    data: {
      id: 'meal-pasta',
      name: 'Cream pasta',
      components: {
        create: [
          { ingredientId: 'pasta', quantityPerServing: 100 },
          { ingredientId: 'cream', quantityPerServing: 50 },
        ],
      },
    },
  })
  const day = (offset: number) => {
    const date = getStartOfTodayInTimezone(TZ)
    date.setDate(date.getDate() + offset)
    return date
  }
  const entry = (id: string, planId: string, offset: number) =>
    prisma.mealPlanEntry.create({
      data: { id, planId, date: day(offset), mealType: 'dinner', mealId: 'meal-pasta' },
    })
  await entry('entry-a', 'plan-alder', 2)
  await entry('entry-b', 'plan-alder', 3)
  await entry('entry-birch', 'plan-birch', 2)
  return { alder, birch }
}

async function needed(householdId: string) {
  const { groups } = await computeRollingWindowShoppingList(householdId, 7, TZ)
  return Object.fromEntries(
    groups.flatMap((g) => g.items).map((item) => [item.ingredientId, item.neededQuantity]),
  )
}

const change = (
  householdId: string,
  originalIngredientId: string | null,
  replacementIngredientId: string | null,
  quantityPerServing: number | null,
  entryId = 'entry-a',
) =>
  addEntryChange(householdId, 'plan-alder', entryId, {
    originalIngredientId,
    replacementIngredientId,
    quantityPerServing,
  })

describe('shopping list with ingredient changes', () => {
  it("buys the replacement at its quantity times the entry's servings, and the original only for the other entry", async () => {
    const { alder } = await world()
    await change(alder.id, 'cream', 'yoghurt', 60)

    // entry-a: 3 × 60 g yoghurt. entry-b keeps its 3 × 50 g cream.
    expect(await needed(alder.id)).toEqual({ pasta: 600, cream: 150, yoghurt: 180 })
  })

  it('uses the serving override as the servings', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({ where: { id: 'entry-a' }, data: { servingOverride: 5 } })
    await change(alder.id, 'cream', 'yoghurt', 60)

    expect(await needed(alder.id)).toMatchObject({ yoghurt: 300 })
  })

  it('drops a left-out ingredient', async () => {
    const { alder } = await world()
    await change(alder.id, 'cream', null, null)
    await change(alder.id, 'cream', null, null, 'entry-b')

    expect(await needed(alder.id)).toEqual({ pasta: 600 })
  })

  it('buys an added ingredient', async () => {
    const { alder } = await world()
    await change(alder.id, null, 'chili', 4)

    expect(await needed(alder.id)).toEqual({ pasta: 600, cream: 300, chili: 12 })
  })

  it("leaves another household's list on the recipe", async () => {
    const { alder, birch } = await world()
    await change(alder.id, 'cream', 'yoghurt', 60)

    expect(await needed(birch.id)).toEqual({ pasta: 100, cream: 50 })
  })

  it('merges the changes in the per-plan list too', async () => {
    const { alder } = await world()
    await change(alder.id, 'cream', 'yoghurt', 60)

    const groups = await computeShoppingList('plan-alder', alder.id, TZ)
    const items = Object.fromEntries(
      groups.flatMap((g) => g.items).map((item) => [item.ingredientId, item.neededQuantity]),
    )
    expect(items).toEqual({ pasta: 600, cream: 150, yoghurt: 180 })
  })
})
