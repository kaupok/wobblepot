import { describe, expect, it } from 'vitest'

import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { getMealPlan } from './get-meal-plan'
import { getPantry } from './get-pantry'
import { rateMeal } from './rate-meal'
import { setMealStatus } from './set-meal-status'

// Runs against PGlite through the `unit-db` project, with no mocks (HON-1330).
// Vitest runs in UTC, so the household does too, and every date is relative
// to the real today.

const CALLER = { userId: 'user-1' }
const TIMEZONE = 'UTC'
const BIRCH_ID = 'household-birch'

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
 * Alder, with no members, so a meal is one serving: tomorrow a planned stew
 * (100 g peas), in two days a fridge meal of peas and oats, in three days an
 * empty slot. Alder's pantry holds 500 g of peas, 300 g of oats and 200 g of
 * kale. Birch, a second household, has a planned stew in four days.
 */
async function world() {
  const alder = await prisma.household.create({
    data: { name: 'Alder', timezone: TIMEZONE, mealPlans: { create: { id: 'plan-alder' } } },
  })
  await prisma.household.create({
    data: {
      id: BIRCH_ID,
      name: 'Birch',
      timezone: TIMEZONE,
      mealPlans: { create: { id: 'plan-birch' } },
    },
  })
  await ingredient('ing-peas', 'glimmer peas')
  await ingredient('ing-oats', 'hush oats')
  await ingredient('ing-kale', 'drift kale')
  await prisma.meal.create({
    data: {
      id: 'stew',
      name: 'Glimmer stew',
      suitableFor: ['dinner'],
      components: { create: [{ ingredientId: 'ing-peas', quantityPerServing: 100 }] },
    },
  })
  await prisma.pantryItem.createMany({
    data: [
      { householdId: alder.id, ingredientId: 'ing-peas', quantity: 500, isStaple: false },
      { householdId: alder.id, ingredientId: 'ing-oats', quantity: 300, isStaple: false },
      { householdId: alder.id, ingredientId: 'ing-kale', quantity: 200, isStaple: false },
    ],
  })
  const dinner = (id: string, offset: number, data: { mealId?: string; planId?: string }) =>
    prisma.mealPlanEntry.create({
      data: {
        id,
        planId: 'plan-alder',
        date: parseLocalDate(day(offset)),
        mealType: 'dinner',
        ...data,
      },
    })
  await dinner('entry-planned', 1, { mealId: 'stew' })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-fridge',
      planId: 'plan-alder',
      date: parseLocalDate(day(2)),
      mealType: 'dinner',
      kind: 'fridge',
      items: {
        create: [
          { position: 0, ingredientId: 'ing-peas' },
          { position: 1, ingredientId: 'ing-oats' },
        ],
      },
    },
  })
  await dinner('entry-empty', 3, {})
  await dinner('entry-birch', 4, { mealId: 'stew', planId: 'plan-birch' })

  return mcpHousehold({ id: alder.id, locale: 'en', timezone: TIMEZONE })
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, date: string, input: Record<string, unknown>) {
  return setMealStatus.run(
    household,
    setMealStatus.inputSchema.parse({ date, mealType: 'dinner', ...input }),
    CALLER,
  )
}

async function refusal(household: Household, date: string, input: Record<string, unknown>) {
  const error = await call(household, date, input).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ToolInputError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.message
}

/** The day's dinner as the assistant reads it, through get_meal_plan. */
async function dinnerOn(household: Household, date: string) {
  const plan = await getMealPlan.run(household, { from: date, to: date }, CALLER)
  return plan.entries.find((entry) => entry.mealType === 'dinner')
}

/** The household's pantry as the assistant reads it, through get_pantry: `ingredientId → quantity`. */
async function pantry(household: Household) {
  const { items } = await getPantry.run(household, {}, CALLER)
  return Object.fromEntries(items.map((item) => [item.ingredientId, item.quantity]))
}

const STOCKED = { 'ing-peas': 500, 'ing-oats': 300, 'ing-kale': 200 }

describe('set_meal_status', () => {
  it('marks a planned recipe dinner cooked and takes its ingredients out of the pantry', async () => {
    const household = await world()

    const result = await call(household, day(1), { status: 'cooked' })

    expect(result).toEqual({
      outcome: 'updated',
      date: day(1),
      mealType: 'dinner',
      status: 'cooked',
      meal: { id: 'stew', name: 'Glimmer stew' },
      pantryDeducted: true,
    })
    expect(await dinnerOn(household, day(1))).toMatchObject({ isCooked: true, isSkipped: false })
    expect(await pantry(household)).toEqual({ ...STOCKED, 'ing-peas': 400 })
  })

  it('answers a second cooked with unchanged and charges the pantry nothing more', async () => {
    const household = await world()
    await call(household, day(1), { status: 'cooked' })

    const again = await call(household, day(1), { status: 'cooked' })

    expect(again).toMatchObject({ outcome: 'unchanged', status: 'cooked', pantryDeducted: false })
    expect(await pantry(household)).toEqual({ ...STOCKED, 'ing-peas': 400 })
  })

  it('marks a fridge meal cooked and its named pantry items used up', async () => {
    const household = await world()

    // Kale is in the pantry but not in the meal, so it stays.
    const result = await call(household, day(2), {
      status: 'cooked',
      usedUpIngredientIds: ['ing-peas', 'ing-kale'],
    })

    expect(result).toMatchObject({ outcome: 'updated', meal: null, pantryDeducted: true })
    expect(await dinnerOn(household, day(2))).toMatchObject({ kind: 'fridge', isCooked: true })
    expect(await pantry(household)).toEqual({ ...STOCKED, 'ing-peas': 0 })
  })

  it('marks a dinner skipped and leaves the pantry', async () => {
    const household = await world()

    const result = await call(household, day(1), { status: 'skipped' })

    expect(result).toMatchObject({ outcome: 'updated', status: 'skipped', pantryDeducted: false })
    expect(await dinnerOn(household, day(1))).toMatchObject({ isCooked: false, isSkipped: true })
    expect(await pantry(household)).toEqual(STOCKED)
  })

  it('sets a cooked dinner back to planned and leaves the pantry as it is', async () => {
    const household = await world()
    await call(household, day(1), { status: 'cooked' })

    const result = await call(household, day(1), { status: 'planned' })

    expect(result).toMatchObject({ outcome: 'updated', status: 'planned', pantryDeducted: false })
    expect(await dinnerOn(household, day(1))).toMatchObject({ isCooked: false, isSkipped: false })
    expect(await pantry(household)).toEqual({ ...STOCKED, 'ing-peas': 400 })

    // Cooked again after the revert: the entry was charged once already.
    const recooked = await call(household, day(1), { status: 'cooked' })
    expect(recooked).toMatchObject({ outcome: 'updated', pantryDeducted: false })
    expect(await pantry(household)).toEqual({ ...STOCKED, 'ing-peas': 400 })
  })

  it.each([
    ['a recipe meal', 1, 'cooked'],
    ['a fridge meal set to skipped', 2, 'skipped'],
  ])('refuses usedUpIngredientIds on %s, and nothing changes', async (_, offset, status) => {
    const household = await world()

    expect(
      await refusal(household, day(offset), { status, usedUpIngredientIds: ['ing-peas'] }),
    ).toMatch(/^usedUpIngredientIds is only for marking a fridge meal cooked/)
    expect(await dinnerOn(household, day(offset))).toMatchObject({
      isCooked: false,
      isSkipped: false,
    })
    expect(await pantry(household)).toEqual(STOCKED)
  })

  it('refuses an empty slot', async () => {
    const household = await world()

    expect(await refusal(household, day(3), { status: 'cooked' })).toMatch(
      /^No meal is planned for dinner on .*nothing to mark/,
    )
    expect(await dinnerOn(household, day(3))).toMatchObject({ isCooked: false })
  })

  it('refuses a slot with no entry', async () => {
    const household = await world()

    expect(await refusal(household, day(6), { status: 'cooked' })).toMatch(
      /^Nothing is planned for dinner on /,
    )
  })

  it('lets rate_meal rate the dinner once it is cooked', async () => {
    const household = await world()
    await call(household, day(1), { status: 'cooked' })

    const rated = await rateMeal.run(
      household,
      { date: day(1), mealType: 'dinner', rating: 'up' },
      CALLER,
    )

    expect(rated).toMatchObject({ meal: { id: 'stew' }, rating: 'up' })
  })

  it("never finds or changes another household's entry", async () => {
    const household = await world()

    expect(await refusal(household, day(4), { status: 'cooked' })).toMatch(
      /^Nothing is planned for dinner on /,
    )
    const birch = mcpHousehold({ id: BIRCH_ID, locale: 'en', timezone: TIMEZONE })
    expect(await dinnerOn(birch, day(4))).toMatchObject({
      entryId: 'entry-birch',
      isCooked: false,
      isSkipped: false,
    })
  })

  it('answers a read-only token with the reconnect message, and the entry stays planned', async () => {
    const household = await world()

    const result = await runTool(
      setMealStatus,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      { date: day(1), mealType: 'dinner', status: 'cooked' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await dinnerOn(household, day(1))).toMatchObject({ isCooked: false })
    expect(await pantry(household)).toEqual(STOCKED)
  })
})
