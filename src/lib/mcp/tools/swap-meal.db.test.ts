import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { ToolInputError } from '@/lib/mcp/context'
import { mcpHousehold } from '@/test/mcp'
import { swapMeal } from './swap-meal'
import { getMealPlan } from './get-meal-plan'

// A swap on a past slot logs what the household ate (HON-1382). Runs against
// PGlite through the `unit-db` project, with no mocks, so the no-repeat rule
// and the pantry are real rows. Vitest runs in UTC, so the household does too,
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
 * Alder has a plan, a trout dinner made of the trout in its pantry, a stew
 * dinner, a lunch-only salad, and 400 g of trout in the pantry.
 */
async function world() {
  await prisma.ingredient.create({
    data: {
      id: 'ing-trout',
      name: 'glimmer trout',
      category: 'protein',
      defaultUnit: 'g',
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
      preferences: { create: {} },
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
  await prisma.meal.create({ data: { id: 'stew', name: 'Glimmer stew', suitableFor: ['dinner'] } })
  await prisma.meal.create({ data: { id: 'salad', name: 'Glimmer salad', suitableFor: ['lunch'] } })

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
      pantryDeductedAt: null,
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

  it('refuses a meal that is not a dinner', async () => {
    const household = await world()
    const date = day(-1)
    const entry = await dinner(date, 'stew')

    expect(await refusal(household, { date, mealType: 'dinner', mealId: 'salad' })).toBe(
      'This meal is not a dinner, so it cannot be logged for dinner. Nothing was changed.',
    )
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      mealId: 'stew',
      status: 'planned',
    })
  })
})

describe('swap_meal on a slot from today on', () => {
  it('still refuses a meal outside the suggestion pool', async () => {
    const household = await world()
    const date = day(0)
    await dinner(day(-3), 'trout', 'completed')
    const entry = await dinner(date, 'stew')

    expect(await refusal(household, { date, mealType: 'dinner', mealId: 'trout' })).toContain(
      'Wobblepot would not suggest this meal',
    )
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      mealId: 'stew',
      status: 'planned',
    })
  })
})
