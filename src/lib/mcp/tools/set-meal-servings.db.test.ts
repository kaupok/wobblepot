import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { setMealServings } from './set-meal-servings'
import { getMealPlan } from './get-meal-plan'

// Runs against PGlite through the `unit-db` project, with no mocks (HON-1331).
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

/**
 * Alder, with no members, so its default is one serving: tomorrow a planned
 * stew (100 g peas a serving), in two days a fridge meal, in three days an
 * empty slot, in five days a cooked stew for 3. Birch, a second household,
 * has a planned stew in four days.
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
  await prisma.ingredient.create({
    data: {
      id: 'ing-peas',
      name: 'glimmer peas',
      category: 'vegetable',
      defaultUnit: 'g',
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  })
  await prisma.meal.create({
    data: {
      id: 'stew',
      name: 'Glimmer stew',
      suitableFor: ['dinner'],
      components: { create: [{ ingredientId: 'ing-peas', quantityPerServing: 100 }] },
    },
  })
  const dinner = (
    id: string,
    offset: number,
    data: {
      mealId?: string
      planId?: string
      kind?: 'fridge'
      status?: 'completed'
      servingOverride?: number
    },
  ) =>
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
  await dinner('entry-fridge', 2, { kind: 'fridge' })
  await dinner('entry-empty', 3, {})
  await dinner('entry-birch', 4, { mealId: 'stew', planId: 'plan-birch' })
  await dinner('entry-cooked', 5, { mealId: 'stew', status: 'completed', servingOverride: 3 })

  // No members, as in the database, so `get_meal_plan` and the shopping list
  // agree on the default.
  return mcpHousehold({
    id: alder.id,
    locale: 'en',
    timezone: TIMEZONE,
    members: [],
    _count: { members: 0 },
  })
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, date: string, servings: number | null) {
  return setMealServings.run(
    household,
    setMealServings.inputSchema.parse({ date, mealType: 'dinner', servings }),
    CALLER,
  )
}

async function refusal(household: Household, date: string, servings: number | null = 6) {
  const error = await call(household, date, servings).then(
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

async function peasOnTheList(household: Household) {
  return (await loadShoppingList(household, { days: 7 })).groups
    .flatMap((group) => group.items)
    .find((item) => item.ingredientId === 'ing-peas')?.quantity
}

describe('set_meal_servings', () => {
  it('sets a planned dinner to 6, so get_meal_plan and the shopping list follow', async () => {
    const household = await world()
    expect(await peasOnTheList(household)).toBe(100)

    const result = await call(household, day(1), 6)

    expect(result).toEqual({
      date: day(1),
      mealType: 'dinner',
      meal: { id: 'stew', name: 'Glimmer stew' },
      servings: 6,
      isDefault: false,
    })
    expect(setMealServings.outputSchema.safeParse(result).success).toBe(true)
    expect(await dinnerOn(household, day(1))).toMatchObject({ servings: 6 })
    expect(await peasOnTheList(household)).toBe(600)
  })

  it('puts the dinner back on the household default with null', async () => {
    const household = await world()
    await call(household, day(1), 6)

    const result = await call(household, day(1), null)

    expect(result).toMatchObject({ servings: 1, isDefault: true })
    expect(await dinnerOn(household, day(1))).toMatchObject({ servings: 1 })
    expect(await peasOnTheList(household)).toBe(100)
  })

  it.each([0, 21, 2.5, '6'])('rejects servings %s at input validation', (servings) => {
    const parsed = setMealServings.inputSchema.safeParse({
      date: day(1),
      mealType: 'dinner',
      servings,
    })

    expect(parsed.success).toBe(false)
  })

  it.each([3, 6, null])(
    'refuses a cooked dinner (servings %s), and its count stays',
    async (servings) => {
      const household = await world()

      expect(await refusal(household, day(5), servings)).toMatch(
        /already cooked, and the pantry was charged/,
      )
      expect(await dinnerOn(household, day(5))).toMatchObject({ isCooked: true, servings: 3 })
    },
  )

  it('refuses a fridge meal', async () => {
    const household = await world()

    expect(await refusal(household, day(2))).toMatch(/is a fridge meal, which has no recipe/)
  })

  it('refuses an empty slot', async () => {
    const household = await world()

    expect(await refusal(household, day(3))).toMatch(/^No meal is planned for dinner on /)
  })

  it('refuses a slot with no entry', async () => {
    const household = await world()

    expect(await refusal(household, day(6))).toMatch(/^Nothing is planned for dinner on /)
  })

  it("never finds or changes another household's entry", async () => {
    const household = await world()

    expect(await refusal(household, day(4))).toMatch(/^Nothing is planned for dinner on /)
    const birch = mcpHousehold({
      id: BIRCH_ID,
      locale: 'en',
      timezone: TIMEZONE,
      members: [],
      _count: { members: 0 },
    })
    expect(await dinnerOn(birch, day(4))).toMatchObject({ entryId: 'entry-birch', servings: 1 })
  })

  it('answers a read-only token with the reconnect message, and the count stays', async () => {
    const household = await world()

    const result = await runTool(
      setMealServings,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      { date: day(1), mealType: 'dinner', servings: 6 },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await dinnerOn(household, day(1))).toMatchObject({ servings: 1 })
  })
})
