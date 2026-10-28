import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { clearMeal } from './clear-meal'
import { getMealPlan } from './get-meal-plan'

// Runs against PGlite through the `unit-db` project, with no mocks (HON-1329).
// Vitest runs in UTC, so the household does too, and every date is relative
// to the real today.

const CALLER = { userId: 'user-1' }
const TIMEZONE = 'UTC'

function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone(TIMEZONE))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

/**
 * Alder's dinners: yesterday a cooked stew, tomorrow a planned stew, in two
 * days a skipped stew, in three days a fridge meal, in four days an empty
 * slot. Birch, a second household, has a planned stew in five days.
 */
async function world() {
  const alder = await prisma.household.create({
    data: { name: 'Alder', timezone: TIMEZONE, mealPlans: { create: { id: 'plan-alder' } } },
  })
  await prisma.household.create({
    data: { name: 'Birch', timezone: TIMEZONE, mealPlans: { create: { id: 'plan-birch' } } },
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
    data: { mealId?: string; status?: 'planned' | 'completed' | 'skipped'; planId?: string },
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
  await dinner('entry-cooked', -1, { mealId: 'stew', status: 'completed' })
  await dinner('entry-planned', 1, { mealId: 'stew' })
  await dinner('entry-skipped', 2, { mealId: 'stew', status: 'skipped' })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-fridge',
      planId: 'plan-alder',
      date: parseLocalDate(day(3)),
      mealType: 'dinner',
      kind: 'fridge',
      items: {
        create: [
          { position: 0, ingredientId: 'ing-peas' },
          { position: 1, sourceEntryId: 'entry-cooked' },
          { position: 2, label: 'Meatballs' },
        ],
      },
    },
  })
  await dinner('entry-empty', 4, {})
  await dinner('entry-birch', 5, { mealId: 'stew', planId: 'plan-birch' })

  return mcpHousehold({ id: alder.id, locale: 'en', timezone: TIMEZONE })
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, date: string) {
  return clearMeal.run(household, clearMeal.inputSchema.parse({ date, mealType: 'dinner' }), CALLER)
}

async function refusal(household: Household, date: string) {
  const error = await call(household, date).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ToolInputError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.message
}

/** The day's dinner as the assistant reads it, through get_meal_plan. */
async function dinnerOn(household: Household, date: string) {
  const plan = await getMealPlan.run(household, { from: date, to: date }, CALLER)
  return plan.entries.filter((entry) => entry.mealType === 'dinner')
}

async function entryIds() {
  return (
    await prisma.mealPlanEntry.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  ).map((entry) => entry.id)
}

describe('clear_meal', () => {
  it('clears a planned recipe dinner, so get_meal_plan and the shopping list drop it', async () => {
    const household = await world()
    const peasBefore = (await loadShoppingList(household, { days: 7 })).groups
      .flatMap((group) => group.items)
      .find((item) => item.ingredientId === 'ing-peas')
    // Only tomorrow's stew is planned in the window, so the list holds its peas.
    expect(peasBefore).toMatchObject({ mealCount: 1 })

    const result = await call(household, day(1))

    expect(result).toEqual({
      outcome: 'cleared',
      date: day(1),
      mealType: 'dinner',
      kind: 'recipe',
      meal: { id: 'stew', name: 'Glimmer stew' },
      items: [],
    })
    expect(clearMeal.outputSchema.safeParse(result).success).toBe(true)
    expect(await dinnerOn(household, day(1))).toEqual([])
    const listed = (await loadShoppingList(household, { days: 7 })).groups.flatMap(
      (group) => group.items,
    )
    expect(listed.map((item) => item.ingredientId)).not.toContain('ing-peas')
  })

  it('clears a skipped meal', async () => {
    const household = await world()

    const result = await call(household, day(2))

    expect(result).toMatchObject({ outcome: 'cleared', kind: 'recipe', meal: { id: 'stew' } })
    expect(await dinnerOn(household, day(2))).toEqual([])
  })

  it('clears a fridge meal and returns its items', async () => {
    const household = await world()

    const result = await call(household, day(3))

    expect(result).toEqual({
      outcome: 'cleared',
      date: day(3),
      mealType: 'dinner',
      kind: 'fridge',
      meal: null,
      items: [
        { name: 'glimmer peas', source: 'pantry', sourceEntryId: null, servings: null },
        { name: 'Glimmer stew', source: 'leftover', sourceEntryId: 'entry-cooked', servings: null },
        { name: 'Meatballs', source: 'text', sourceEntryId: null, servings: null },
      ],
    })
    expect(clearMeal.outputSchema.safeParse(result).success).toBe(true)
    expect(await dinnerOn(household, day(3))).toEqual([])
  })

  it('refuses a cooked meal, and the entry stays', async () => {
    const household = await world()

    expect(await refusal(household, day(-1))).toBe(
      `The dinner on ${day(-1)} is cooked, so it cannot be cleared. Nothing was changed.`,
    )
    expect(await dinnerOn(household, day(-1))).toEqual([
      expect.objectContaining({ entryId: 'entry-cooked', mealId: 'stew', isCooked: true }),
    ])
  })

  it('refuses an empty slot, and nothing is deleted', async () => {
    const household = await world()
    const before = await entryIds()

    expect(await refusal(household, day(4))).toBe(
      `No meal is planned for dinner on ${day(4)}, so there is nothing to clear. Nothing was changed.`,
    )
    expect(await entryIds()).toEqual(before)
  })

  it('refuses a slot with no entry, and nothing is deleted', async () => {
    const household = await world()
    const before = await entryIds()

    expect(await refusal(household, day(6))).toMatch(/^Nothing is planned for dinner on /)
    expect(await entryIds()).toEqual(before)
  })

  it("never finds or deletes another household's entry", async () => {
    const household = await world()

    expect(await refusal(household, day(5))).toMatch(/^Nothing is planned for dinner on /)
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: 'entry-birch' } })).not.toBeNull()
  })

  it('answers a read-only token with the reconnect message, and the entry stays', async () => {
    const household = await world()

    const result = await runTool(
      clearMeal,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      { date: day(1), mealType: 'dinner' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await dinnerOn(household, day(1))).toEqual([
      expect.objectContaining({ entryId: 'entry-planned', mealId: 'stew' }),
    ])
  })
})
