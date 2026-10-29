import { describe, expect, it } from 'vitest'

import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'
import { mcpHousehold } from '@/test/mcp'

import { planFridgeMeal } from './plan-fridge-meal'
import { planMeal } from './plan-meal'
import { setMealStatus } from './set-meal-status'
import { swapMeal } from './swap-meal'

// A meal logged on a past day is saved as already charged, so setting it back
// to planned and then cooked never charges the pantry for it (HON-1391).
// Runs against PGlite through the `unit-db` project, with no mocks. Vitest
// runs in UTC, so the household does too, and every date is relative to the
// real today.

const CALLER = { userId: 'user-1' }
const TIMEZONE = 'UTC'

function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone(TIMEZONE))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

const ingredient = (id: string, name: string) =>
  prisma.ingredient.create({
    data: {
      id,
      name,
      category: 'vegetable',
      defaultUnit: 'g',
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  })

/**
 * Alder, with no members, so a meal is one serving: a stew (100 g peas) and a
 * porridge (50 g oats), both dinners. The pantry holds 500 g of peas and
 * 300 g of oats.
 */
async function world() {
  const alder = await prisma.household.create({
    data: { name: 'Alder', timezone: TIMEZONE, mealPlans: { create: { id: 'plan-alder' } } },
  })
  await ingredient('ing-peas', 'glimmer peas')
  await ingredient('ing-oats', 'hush oats')
  const meal = (id: string, ingredientId: string, quantityPerServing: number) =>
    prisma.meal.create({
      data: {
        id,
        name: `Glimmer ${id}`,
        suitableFor: ['dinner'],
        components: { create: [{ ingredientId, quantityPerServing }] },
      },
    })
  await meal('stew', 'ing-peas', 100)
  await meal('porridge', 'ing-oats', 50)
  await prisma.pantryItem.createMany({
    data: [
      { householdId: alder.id, ingredientId: 'ing-peas', quantity: 500, isStaple: false },
      { householdId: alder.id, ingredientId: 'ing-oats', quantity: 300, isStaple: false },
    ],
  })
  return mcpHousehold({ id: alder.id, locale: 'en', timezone: TIMEZONE })
}

type Household = Awaited<ReturnType<typeof world>>

const STOCKED = { 'ing-peas': 500, 'ing-oats': 300 }

async function pantry(household: Household) {
  const rows = await prisma.pantryItem.findMany({ where: { householdId: household.id } })
  return Object.fromEntries(rows.map((row) => [row.ingredientId, row.quantity]))
}

/** A planned past dinner, as the household left it before the day passed. */
function plannedDinner(date: string, mealId: string) {
  return prisma.mealPlanEntry.create({
    data: { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'dinner', mealId },
  })
}

/** `set_meal_status` planned, then cooked, on the day's dinner. */
async function revertThenCook(household: Household, date: string, cooked: object = {}) {
  const status = (input: Record<string, unknown>) =>
    setMealStatus.run(
      household,
      setMealStatus.inputSchema.parse({ date, mealType: 'dinner', ...input }),
      CALLER,
    )
  await status({ status: 'planned' })
  return status({ status: 'cooked', ...cooked })
}

describe('a meal logged on a past day, set to planned and then cooked', () => {
  it('through plan_meal leaves the pantry unchanged', async () => {
    const household = await world()
    const date = day(-1)
    await planMeal.run(household, { date, mealType: 'dinner', mealId: 'stew' }, CALLER)

    const cooked = await revertThenCook(household, date)

    expect(cooked).toMatchObject({ outcome: 'updated', status: 'cooked', pantryDeducted: false })
    expect(await pantry(household)).toEqual(STOCKED)
  })

  it('through swap_meal leaves the pantry unchanged', async () => {
    const household = await world()
    const date = day(-2)
    await plannedDinner(date, 'porridge')
    await swapMeal.run(household, { date, mealType: 'dinner', mealId: 'stew' }, CALLER)

    const cooked = await revertThenCook(household, date)

    expect(cooked).toMatchObject({ outcome: 'updated', status: 'cooked', pantryDeducted: false })
    expect(await pantry(household)).toEqual(STOCKED)
  })

  it('through plan_fridge_meal in an empty slot leaves the pantry unchanged', async () => {
    const household = await world()
    const date = day(-3)
    await planFridgeMeal.run(
      household,
      planFridgeMeal.inputSchema.parse({
        date,
        mealType: 'dinner',
        items: [{ ingredientId: 'ing-peas' }],
      }),
      CALLER,
    )

    const cooked = await revertThenCook(household, date, { usedUpIngredientIds: ['ing-peas'] })

    expect(cooked).toMatchObject({ outcome: 'updated', status: 'cooked', pantryDeducted: false })
    expect(await pantry(household)).toEqual(STOCKED)
  })

  it('through plan_fridge_meal over a planned meal leaves the pantry unchanged', async () => {
    const household = await world()
    const date = day(-4)
    await plannedDinner(date, 'stew')
    await planFridgeMeal.run(
      household,
      planFridgeMeal.inputSchema.parse({
        date,
        mealType: 'dinner',
        items: [{ ingredientId: 'ing-oats' }],
      }),
      CALLER,
    )

    const cooked = await revertThenCook(household, date, { usedUpIngredientIds: ['ing-oats'] })

    expect(cooked).toMatchObject({ outcome: 'updated', status: 'cooked', pantryDeducted: false })
    expect(await pantry(household)).toEqual(STOCKED)
  })
})

describe('a planned past meal marked cooked', () => {
  it('still takes its ingredients out of the pantry', async () => {
    const household = await world()
    const date = day(-1)
    await plannedDinner(date, 'stew')

    const cooked = await setMealStatus.run(
      household,
      setMealStatus.inputSchema.parse({ date, mealType: 'dinner', status: 'cooked' }),
      CALLER,
    )

    expect(cooked).toMatchObject({ outcome: 'updated', pantryDeducted: true })
    expect(await pantry(household)).toEqual({ ...STOCKED, 'ing-peas': 400 })
  })
})
