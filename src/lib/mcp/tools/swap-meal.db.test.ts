import { describe, expect, it } from 'vitest'

import { ToolInputError } from '@/lib/mcp/context'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'
import { mcpHousehold } from '@/test/mcp'

import { getMealPlan } from './get-meal-plan'
import { swapMeal } from './swap-meal'

// A swap on a past slot logs what the household ate (HON-1382); from today on,
// a chosen meal may repeat (HON-1392). Runs against PGlite through the
// `unit-db` project, with no mocks, so the no-repeat rule and the pantry are
// real rows. Vitest runs in UTC, so the household does too,
// and every date is relative to the real today. The mocked
// `swap-meal.test.ts` covers the suggestions.

const CALLER = { userId: 'user-1' }
const TIMEZONE = 'UTC'

function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone(TIMEZONE))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

/**
 * Alder avoids peanuts. It has a plan, a trout dinner made of the trout in its
 * pantry, a stew dinner with carrot, a soup dinner, a shared dinner with
 * peanut butter, a lunch-only salad, and 400 g of trout in the pantry. Birch
 * is a second household with its own dinner.
 */
async function world() {
  const ingredient = (id: string, data: Record<string, unknown> = {}) =>
    prisma.ingredient.create({
      data: {
        id,
        name: `glimmer ${id}`,
        category: 'protein',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
        ...data,
      },
    })
  await ingredient('ing-trout')
  await ingredient('ing-carrot', { category: 'vegetable' })
  await ingredient('ing-peanut', { category: 'spice', allergens: ['peanuts'] })
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'en',
      timezone: TIMEZONE,
      preferences: { create: { allergensToAvoid: ['peanuts'] } },
      mealPlans: { create: { id: 'plan-alder' } },
      pantryItems: { create: { ingredientId: 'ing-trout', quantity: 400 } },
    },
    include: { preferences: true },
  })
  await prisma.meal.create({
    data: {
      id: 'trout',
      name: 'Glimmer trout',
      suitableFor: ['dinner'],
      components: { create: [{ ingredientId: 'ing-trout', quantityPerServing: 150 }] },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'stew',
      name: 'Glimmer stew',
      suitableFor: ['dinner'],
      components: { create: [{ ingredientId: 'ing-carrot', quantityPerServing: 100 }] },
    },
  })
  await prisma.meal.create({ data: { id: 'soup', name: 'Glimmer soup', suitableFor: ['dinner'] } })
  await prisma.meal.create({
    data: {
      id: 'satay',
      name: 'Glimmer satay',
      suitableFor: ['dinner'],
      components: { create: [{ ingredientId: 'ing-peanut', quantityPerServing: 30 }] },
    },
  })
  await prisma.meal.create({ data: { id: 'salad', name: 'Glimmer salad', suitableFor: ['lunch'] } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  await prisma.meal.create({
    data: { id: 'birch-pie', name: 'Glimmer pie', suitableFor: ['dinner'], householdId: birch.id },
  })

  return mcpHousehold({
    id: alder.id,
    locale: 'en',
    timezone: TIMEZONE,
    preferences: alder.preferences,
  })
}

type Household = Awaited<ReturnType<typeof world>>

function dinner(date: string, mealId: string, status: 'planned' | 'completed' = 'planned') {
  return prisma.mealPlanEntry.create({
    data: { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'dinner', mealId, status },
  })
}

function call(household: Household, input: Record<string, unknown>) {
  return swapMeal.run(household, swapMeal.inputSchema.parse(input), CALLER)
}

async function refusal(household: Household, input: Record<string, unknown>) {
  const error = await call(household, input).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ToolInputError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.message
}

async function pantryQuantities(householdId: string) {
  const rows = await prisma.pantryItem.findMany({ where: { householdId } })
  return rows.map((row) => [row.ingredientId, row.quantity])
}

describe('swap_meal on a past slot', () => {
  it('logs a meal cooked 3 days earlier as cooked, leaving the pantry alone', async () => {
    const household = await world()
    const date = day(-1)
    await dinner(day(-4), 'trout', 'completed')
    const entry = await dinner(date, 'stew')

    const result = await call(household, { date, mealType: 'dinner', mealId: 'trout' })

    expect(result).toMatchObject({
      outcome: 'swapped',
      meal: { id: 'trout', name: 'Glimmer trout' },
    })
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      mealId: 'trout',
      status: 'completed',
      pantryDeductedAt: expect.any(Date),
    })
    expect(await pantryQuantities(household.id)).toEqual([['ing-trout', 400]])

    const plan = await getMealPlan.run(household, { from: date, to: date }, CALLER)
    expect(plan.entries).toEqual([
      expect.objectContaining({ date, mealId: 'trout', isCooked: true }),
    ])
  })

  it('refuses a cooked slot', async () => {
    const household = await world()
    const date = day(-1)
    const entry = await dinner(date, 'stew', 'completed')

    expect(await refusal(household, { date, mealType: 'dinner', mealId: 'trout' })).toBe(
      `The dinner on ${date} was already cooked, so it cannot be swapped. Nothing was changed.`,
    )
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      mealId: 'stew',
      status: 'completed',
    })
  })

  // A log records what the household ate, as the Past meals page does, so
  // neither the meal type nor the diet blocks it (HON-1443).
  it('logs a dinner-only recipe eaten at lunch', async () => {
    const household = await world()
    const date = day(-1)
    const entry = await prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-alder',
        date: parseLocalDate(date),
        mealType: 'lunch',
        mealId: 'salad',
      },
    })

    const result = await call(household, { date, mealType: 'lunch', mealId: 'stew' })

    expect(result).toMatchObject({ outcome: 'swapped', meal: { id: 'stew' } })
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      mealId: 'stew',
      mealType: 'lunch',
      status: 'completed',
    })
  })

  it("logs a meal outside the household's diet", async () => {
    const household = await world()
    const date = day(-1)
    const entry = await dinner(date, 'stew')

    const result = await call(household, { date, mealType: 'dinner', mealId: 'satay' })

    expect(result).toMatchObject({ outcome: 'swapped', meal: { id: 'satay' } })
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      mealId: 'satay',
      status: 'completed',
    })
  })

  it.each(['birch-pie', 'missing'])(
    'refuses the meal id %s, and changes nothing',
    async (mealId) => {
      const household = await world()
      const date = day(-1)
      const entry = await dinner(date, 'stew')

      expect(await refusal(household, { date, mealType: 'dinner', mealId })).toBe(
        'No meal with this id. Use list_meals to find the meal. Nothing was changed.',
      )
      expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
        mealId: 'stew',
        status: 'planned',
      })
    },
  )
})

describe('swap_meal on a slot from today on', () => {
  it('swaps in a dinner planned 7 days earlier, and says when', async () => {
    const household = await world()
    const date = day(1)
    await dinner(day(-7), 'trout', 'completed')
    const entry = await prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-alder',
        date: parseLocalDate(date),
        mealType: 'dinner',
        mealId: 'stew',
        servingOverride: 6,
        // A change made on the stew: leave out the carrot.
        changes: { create: [{ originalIngredientId: 'ing-carrot' }] },
      },
    })

    const result = await call(household, { date, mealType: 'dinner', mealId: 'trout' })

    expect(result).toEqual({
      outcome: 'swapped',
      date,
      mealType: 'dinner',
      meal: { id: 'trout', name: 'Glimmer trout' },
      lastPlannedOn: day(-7),
      nextPlannedOn: null,
      suggestions: [],
    })
    // The app's swap: servings back on the household default, and the stew's
    // ingredient changes gone with it.
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      mealId: 'trout',
      status: 'planned',
      servingOverride: null,
    })
    expect(await prisma.mealPlanEntryComponent.count({ where: { entryId: entry.id } })).toBe(0)
  })

  it('swaps in a dinner already planned on the next day, and says when', async () => {
    const household = await world()
    const date = day(1)
    await dinner(date, 'stew')
    await dinner(day(2), 'trout')

    const result = await call(household, { date, mealType: 'dinner', mealId: 'trout' })

    expect(result).toMatchObject({ outcome: 'swapped', lastPlannedOn: null, nextPlannedOn: day(2) })
  })

  it('answers lastPlannedOn null for a meal never planned before', async () => {
    const household = await world()
    const date = day(1)
    await dinner(date, 'stew')

    const result = await call(household, { date, mealType: 'dinner', mealId: 'soup' })

    expect(result).toMatchObject({ outcome: 'swapped', lastPlannedOn: null, nextPlannedOn: null })
  })

  it('still leaves a dinner planned 7 days earlier out of the suggestions', async () => {
    const household = await world()
    const date = day(1)
    await dinner(day(-7), 'trout', 'completed')
    await dinner(date, 'stew')

    const result = await call(household, { date, mealType: 'dinner' })

    // Satay has peanuts, the stew is the meal being replaced, and the trout
    // was planned 7 days ago: the soup is all that is left.
    expect(result).toMatchObject({
      outcome: 'suggestions',
      lastPlannedOn: null,
      nextPlannedOn: null,
    })
    expect(result.suggestions.map((meal) => meal.id)).toEqual(['soup'])
  })

  it.each([
    ['satay', "This meal does not fit the household's diet, allergens or avoided ingredients."],
    ['salad', 'This meal is not a dinner, so it cannot be planned for dinner.'],
    ['birch-pie', 'No meal with this id. Use list_meals to find the meal.'],
    ['missing', 'No meal with this id. Use list_meals to find the meal.'],
  ])('refuses %s, and changes nothing', async (mealId, message) => {
    const household = await world()
    const date = day(1)
    const entry = await dinner(date, 'stew')

    expect(await refusal(household, { date, mealType: 'dinner', mealId })).toBe(
      `${message} Nothing was changed.`,
    )
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      mealId: 'stew',
      status: 'planned',
    })
  })
})
