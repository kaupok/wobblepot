import { describe, expect, it } from 'vitest'

import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { getMealPlan } from './get-meal-plan'
import { listMeals } from './list-meals'
import { planMeal } from './plan-meal'

// Runs against PGlite through the `unit-db` project, with no mocks: the meals,
// plan and preferences are written with Prisma and the entry is read back
// (HON-1306). Vitest runs in UTC, so the household does too, and every date is
// relative to the real today.

const CALLER = { userId: 'user-1' }
const TIMEZONE = 'UTC'

function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone(TIMEZONE))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

/**
 * Alder avoids peanuts. It has its own stew (a dinner, favourited), a shared
 * dinner with peanut butter, a shared lunch-only salad and a deleted dinner.
 * Birch is a second household with its own dinner. `withPlan: false` leaves
 * Alder with no plan row.
 */
async function world({ withPlan = true } = {}) {
  await prisma.ingredient.create({
    data: {
      id: 'ing-peanut',
      name: 'glimmer peanut butter',
      category: 'spice',
      defaultUnit: 'g',
      allergens: ['peanuts'],
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  })
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'en',
      timezone: TIMEZONE,
      preferences: { create: { allergensToAvoid: ['peanuts'] } },
      ...(withPlan ? { mealPlans: { create: { id: 'plan-alder' } } } : {}),
    },
    include: { preferences: true },
  })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })

  const meal = (
    id: string,
    data: { suitableFor: ('breakfast' | 'lunch' | 'dinner')[]; householdId?: string } & Record<
      string,
      unknown
    >,
  ) => prisma.meal.create({ data: { id, name: `Glimmer ${id}`, ...data } })
  await meal('stew', { suitableFor: ['dinner'], householdId: alder.id })
  await meal('satay', {
    suitableFor: ['dinner'],
    components: { create: [{ ingredientId: 'ing-peanut', quantityPerServing: 30 }] },
  })
  await meal('salad', { suitableFor: ['lunch'] })
  await meal('gone', { suitableFor: ['dinner'], deletedAt: new Date() })
  await meal('birch-pie', { suitableFor: ['dinner'], householdId: birch.id })
  await prisma.favoriteMeal.create({ data: { householdId: alder.id, mealId: 'stew' } })

  return mcpHousehold({
    id: alder.id,
    locale: 'en',
    timezone: TIMEZONE,
    preferences: alder.preferences,
  })
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, input: Record<string, unknown>) {
  return planMeal.run(household, planMeal.inputSchema.parse(input), CALLER)
}

function entryCount(householdId: string) {
  return prisma.mealPlanEntry.count({ where: { plan: { householdId } } })
}

async function refusal(household: Household, input: Record<string, unknown>) {
  const before = await entryCount(household.id)
  const error = await call(household, input).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ToolInputError)) throw new Error(`Expected a refusal, got ${error}`)
  expect(await entryCount(household.id)).toBe(before)
  return error.message
}

describe('plan_meal', () => {
  it('plans the meal in an empty slot, and get_meal_plan shows it', async () => {
    const household = await world()
    const date = day(2)

    const result = await call(household, { date, mealType: 'dinner', mealId: 'stew' })

    expect(result).toEqual({
      outcome: 'planned',
      status: 'planned',
      date,
      mealType: 'dinner',
      meal: { id: 'stew', name: 'Glimmer stew' },
      lastPlannedOn: null,
      nextPlannedOn: null,
    })
    const plan = await getMealPlan.run(household, { from: date, to: date }, CALLER)
    expect(plan.entries).toEqual([
      expect.objectContaining({
        date,
        mealType: 'dinner',
        mealId: 'stew',
        mealName: 'Glimmer stew',
        isCooked: false,
        isSkipped: false,
      }),
    ])
    expect(planMeal.outputSchema.safeParse(result).success).toBe(true)
  })

  it('plans a meal planned 7 days earlier again, and says when', async () => {
    const household = await world()
    const earlier = day(-5)
    await prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-alder',
        date: parseLocalDate(earlier),
        mealType: 'dinner',
        mealId: 'stew',
      },
    })

    const result = await call(household, { date: day(2), mealType: 'dinner', mealId: 'stew' })

    expect(result.outcome).toBe('planned')
    expect(result.lastPlannedOn).toBe(earlier)
    expect(await entryCount(household.id)).toBe(2)
  })

  it('plans a meal already planned on a later day, and says when', async () => {
    const household = await world()
    const later = day(3)
    await prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-alder',
        date: parseLocalDate(later),
        mealType: 'dinner',
        mealId: 'stew',
      },
    })

    const result = await call(household, { date: day(2), mealType: 'dinner', mealId: 'stew' })

    expect(result).toMatchObject({ outcome: 'planned', lastPlannedOn: null, nextPlannedOn: later })
  })

  it('replaces an empty picker placeholder', async () => {
    const household = await world()
    const date = day(1)
    await prisma.mealPlanEntry.create({
      data: { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'dinner' },
    })

    await call(household, { date, mealType: 'dinner', mealId: 'stew' })

    const entries = await prisma.mealPlanEntry.findMany({ where: { planId: 'plan-alder' } })
    expect(entries.map((entry) => entry.mealId)).toEqual(['stew'])
  })

  it('creates the plan row for a household with none, with the entry in it', async () => {
    const household = await world({ withPlan: false })
    expect(await prisma.mealPlan.count({ where: { householdId: household.id } })).toBe(0)

    await call(household, { date: day(0), mealType: 'dinner', mealId: 'stew' })

    const plan = await prisma.mealPlan.findUniqueOrThrow({
      where: { householdId: household.id },
      include: { entries: true },
    })
    expect(plan.entries.map((entry) => entry.mealId)).toEqual(['stew'])
  })

  it('accepts today and the day 28 days ahead, as planned meals', async () => {
    const household = await world()

    const today = await call(household, { date: day(0), mealType: 'dinner', mealId: 'stew' })
    await call(household, { date: day(28), mealType: 'dinner', mealId: 'stew' })

    expect(today.status).toBe('planned')
    const entries = await prisma.mealPlanEntry.findMany({ where: { planId: 'plan-alder' } })
    expect(entries.map((entry) => entry.status)).toEqual(['planned', 'planned'])
  })

  describe('on a past day, logs the meal as cooked', () => {
    it("for yesterday's empty dinner, leaving the pantry alone", async () => {
      const household = await world()
      await prisma.pantryItem.create({
        data: { householdId: household.id, ingredientId: 'ing-peanut', quantity: 300 },
      })
      const date = day(-1)

      const result = await call(household, { date, mealType: 'dinner', mealId: 'stew' })

      expect(result).toMatchObject({ outcome: 'planned', status: 'cooked', date })
      const [entry] = await prisma.mealPlanEntry.findMany({ where: { planId: 'plan-alder' } })
      expect(entry).toMatchObject({
        mealId: 'stew',
        status: 'completed',
        pantryDeductedAt: expect.any(Date),
      })
      const pantry = await prisma.pantryItem.findMany({ where: { householdId: household.id } })
      expect(pantry.map((row) => [row.ingredientId, row.quantity])).toEqual([['ing-peanut', 300]])

      const plan = await getMealPlan.run(household, { from: date, to: date }, CALLER)
      expect(plan.entries).toEqual([
        expect.objectContaining({ date, mealId: 'stew', isCooked: true }),
      ])
    })

    it('for a day 60 days back', async () => {
      const household = await world()

      const result = await call(household, { date: day(-60), mealType: 'dinner', mealId: 'stew' })

      expect(result.status).toBe('cooked')
      expect(await entryCount(household.id)).toBe(1)
    })

    // A log records what the household ate, as the Past meals page does, so
    // neither the meal type nor the diet blocks it (HON-1443).
    it('for a dinner-only recipe eaten at lunch', async () => {
      const household = await world()

      const result = await call(household, { date: day(-1), mealType: 'lunch', mealId: 'stew' })

      expect(result).toMatchObject({ status: 'cooked', mealType: 'lunch' })
      const [entry] = await prisma.mealPlanEntry.findMany({ where: { planId: 'plan-alder' } })
      expect(entry).toMatchObject({ mealId: 'stew', mealType: 'lunch', status: 'completed' })
    })

    it("for a meal outside the household's diet", async () => {
      const household = await world()

      const result = await call(household, { date: day(-1), mealType: 'dinner', mealId: 'satay' })

      expect(result).toMatchObject({ status: 'cooked', meal: { id: 'satay' } })
      const [entry] = await prisma.mealPlanEntry.findMany({ where: { planId: 'plan-alder' } })
      expect(entry).toMatchObject({ mealId: 'satay', status: 'completed' })
    })

    it.each(['birch-pie', 'gone', 'no-such-meal'])('refuses the meal id %s', async (mealId) => {
      const household = await world()

      expect(await refusal(household, { date: day(-1), mealType: 'dinner', mealId })).toBe(
        'No meal with this id. Use list_meals to find the meal. Nothing was changed.',
      )
    })

    it('refuses a past slot that has a meal, pointing to swap_meal', async () => {
      const household = await world()
      const date = day(-2)
      await prisma.mealPlanEntry.create({
        data: {
          planId: 'plan-alder',
          date: parseLocalDate(date),
          mealType: 'dinner',
          mealId: 'satay',
        },
      })

      expect(await refusal(household, { date, mealType: 'dinner', mealId: 'stew' })).toContain(
        'Use swap_meal',
      )
    })
  })

  describe('refuses and writes nothing', () => {
    it('for a slot that has a meal, pointing to swap_meal', async () => {
      const household = await world()
      const date = day(3)
      await prisma.mealPlanEntry.create({
        data: {
          planId: 'plan-alder',
          date: parseLocalDate(date),
          mealType: 'dinner',
          mealId: 'satay',
        },
      })

      expect(await refusal(household, { date, mealType: 'dinner', mealId: 'stew' })).toContain(
        'Use swap_meal',
      )
    })

    it('for a slot that has a note', async () => {
      const household = await world()
      const date = day(3)
      await prisma.mealPlanEntry.create({
        data: { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'dinner', note: 'Out' },
      })

      expect(await refusal(household, { date, mealType: 'dinner', mealId: 'stew' })).toContain(
        'Use swap_meal',
      )
    })

    it('for a lunch-only meal on a dinner slot', async () => {
      const household = await world()

      expect(await refusal(household, { date: day(1), mealType: 'dinner', mealId: 'salad' })).toBe(
        'This meal is not a dinner, so it cannot be planned for dinner. Nothing was changed.',
      )
    })

    it('for a meal with an ingredient carrying a household allergen', async () => {
      const household = await world()

      expect(await refusal(household, { date: day(1), mealType: 'dinner', mealId: 'satay' })).toBe(
        "This meal does not fit the household's diet, allergens or avoided ingredients. Nothing was changed.",
      )
    })

    it('for a date 29 days ahead', async () => {
      const household = await world()

      expect(
        await refusal(household, { date: day(29), mealType: 'dinner', mealId: 'stew' }),
      ).toContain('more than 28 days ahead')
    })

    it.each(['birch-pie', 'gone', 'no-such-meal'])('for the meal id %s', async (mealId) => {
      const household = await world()

      expect(await refusal(household, { date: day(1), mealType: 'dinner', mealId })).toBe(
        'No meal with this id. Use list_meals to find the meal. Nothing was changed.',
      )
    })

    it('for a token without mcp:write, with the reconnect sentence', async () => {
      const household = await world()

      const result = await runTool(
        planMeal,
        { userId: CALLER.userId, household, scopes: READ_SCOPES },
        { date: day(1), mealType: 'dinner', mealId: 'stew' },
      )

      expect(result).toEqual({
        isError: true,
        content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
      })
      expect(await entryCount(household.id)).toBe(0)
    })
  })
})

describe('list_meals source', () => {
  function list(household: Household, input: Record<string, unknown>) {
    return listMeals.run(household, listMeals.inputSchema.parse(input), CALLER)
  }

  it("lists only the household's own meals for source own", async () => {
    const household = await world()

    const { meals } = await list(household, { source: 'own' })

    expect(meals.map((meal) => meal.id)).toEqual(['stew'])
  })

  it('lists only favourites for source favourites', async () => {
    const household = await world()
    await prisma.favoriteMeal.create({ data: { householdId: household.id, mealId: 'salad' } })

    const { meals } = await list(household, { source: 'favourites' })

    expect(meals.map((meal) => meal.id).sort()).toEqual(['salad', 'stew'])
  })

  it('lists shared meals too without a source', async () => {
    const household = await world()

    const { meals } = await list(household, { limit: 50 })

    expect(meals.map((meal) => meal.id)).toEqual(expect.arrayContaining(['stew', 'salad']))
  })
})
