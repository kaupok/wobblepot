import { describe, expect, it } from 'vitest'

import { createEntry } from '@/lib/meal-plans/create-entry'
import { prisma } from '@/lib/prisma'

import { getStartOfTodayInTimezone } from './dates'
import { computeRollingWindowShoppingList, computeShoppingList } from './shopping-list'

// A fridge meal adds nothing to the shopping list (HON-1277). Runs against
// PGlite through the `unit-db` project, with no mocks.

const TZ = 'Europe/Tallinn'

const day = (offset: number) => {
  const date = getStartOfTodayInTimezone(TZ)
  date.setDate(date.getDate() + offset)
  return date
}

/**
 * Alder: two adults. A cream pasta is planned for dinner the day after
 * tomorrow: 100 g pasta and 50 g cream per serving. The pantry has 40 g cream
 * and a cucumber.
 */
async function world() {
  for (const id of ['pasta', 'cream', 'cucumber']) {
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
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      members: { create: [{ name: 'A' }, { name: 'B' }] },
      mealPlans: { create: { id: 'plan-alder' } },
      pantryItems: {
        create: [
          { ingredientId: 'cream', quantity: 40 },
          { ingredientId: 'cucumber', quantity: 300 },
        ],
      },
    },
  })
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
  await prisma.mealPlanEntry.create({
    data: { planId: 'plan-alder', date: day(2), mealType: 'dinner', mealId: 'meal-pasta' },
  })
  return { alder }
}

const lists = async (householdId: string) => ({
  plan: await computeShoppingList('plan-alder', householdId, TZ),
  rolling: await computeRollingWindowShoppingList(householdId, 7, TZ),
})

describe('the shopping list with a fridge meal', () => {
  it('equals the list for the same range without it', async () => {
    const { alder } = await world()
    const without = await lists(alder.id)

    await createEntry(alder.id, 'plan-alder', {
      date: day(1),
      mealType: 'dinner',
      fridgeItems: [{ ingredientId: 'cream' }, { ingredientId: 'pasta' }, { label: 'meatballs' }],
    })

    const withFridge = await lists(alder.id)
    expect(withFridge).toEqual(without)
    // The list is the plan's: 200 g pasta, and 100 g cream less the 40 g held.
    const needed = Object.fromEntries(
      without.plan.flatMap((g) => g.items).map((i) => [i.ingredientId, i.neededQuantity]),
    )
    expect(needed).toEqual({ pasta: 200, cream: 100 })
  })
})
