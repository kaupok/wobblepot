import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { planFridgeMeal } from './plan-fridge-meal'
import { getMealPlan } from './get-meal-plan'

// Runs against PGlite through the `unit-db` project, with no mocks (HON-1281).
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
 * Alder has a plan, a shared stew, a shared pea ingredient, its own Estonian
 * name for the peas, and yesterday's dinner of stew, cooked. Birch is a second
 * household with its own ingredient and a cooked entry of its own.
 */
async function world({ locale = 'en' } = {}) {
  const ingredient = (id: string, name: string, householdId?: string) =>
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
        ...(householdId ? { householdId } : {}),
      },
    })
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      locale,
      timezone: TIMEZONE,
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  await ingredient('ing-peas', 'glimmer peas')
  await prisma.ingredientTranslation.create({
    data: { ingredientId: 'ing-peas', locale: 'et', name: 'helkherned' },
  })
  await ingredient('ing-birch', 'birch secret', birch.id)
  await prisma.meal.create({ data: { id: 'stew', name: 'Glimmer stew', suitableFor: ['dinner'] } })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-cooked',
      planId: 'plan-alder',
      date: parseLocalDate(day(-1)),
      mealType: 'dinner',
      mealId: 'stew',
      status: 'completed',
    },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-birch',
      planId: 'plan-birch',
      date: parseLocalDate(day(-1)),
      mealType: 'dinner',
      mealId: 'stew',
      status: 'completed',
    },
  })

  return mcpHousehold({ id: alder.id, locale, timezone: TIMEZONE })
}

type Household = Awaited<ReturnType<typeof world>>

const ITEMS = [
  { ingredientId: 'ing-peas' },
  { sourceEntryId: 'entry-cooked' },
  { label: 'Meatballs' },
]

function call(household: Household, input: Record<string, unknown>) {
  return planFridgeMeal.run(household, planFridgeMeal.inputSchema.parse(input), CALLER)
}

/** What the slot holds, as the app's card reads it through `loadPlanEntries`. */
async function slot(household: Household, date: string) {
  const start = parseLocalDate(date)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const { entries } = await loadPlanEntries(household, { startDate: start, endDate: end })
  return entries.filter((entry) => entry.mealType === 'dinner')
}

async function dinnerOn(date: string) {
  return prisma.mealPlanEntry.findMany({
    where: { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'dinner' },
    include: { items: { orderBy: { position: 'asc' } } },
  })
}

async function refusal(household: Household, input: Record<string, unknown>) {
  const error = await call(household, input).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ToolInputError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.message
}

describe('plan_fridge_meal', () => {
  it('plans a fridge meal in an empty slot, and the card and get_meal_plan show its items', async () => {
    const household = await world()
    const date = day(0)

    const result = await call(household, { date, mealType: 'dinner', items: ITEMS })

    const expectedItems = [
      { name: 'glimmer peas', source: 'pantry' },
      { name: 'Glimmer stew', source: 'leftover' },
      { name: 'Meatballs', source: 'text' },
    ]
    expect(result).toEqual({ outcome: 'planned', date, mealType: 'dinner', items: expectedItems })
    expect(planFridgeMeal.outputSchema.safeParse(result).success).toBe(true)

    const [card] = await slot(household, date)
    expect(card).toMatchObject({ kind: 'fridge', meal: null, status: 'planned' })
    expect(card!.items.map((item) => item.label ?? item.name)).toEqual([
      'glimmer peas',
      'Glimmer stew',
      'Meatballs',
    ])

    const plan = await getMealPlan.run(household, { from: day(-1), to: date }, CALLER)
    expect(plan.entries).toEqual([
      expect.objectContaining({
        entryId: 'entry-cooked',
        date: day(-1),
        kind: 'recipe',
        items: [],
        mealName: 'Glimmer stew',
        isCooked: true,
      }),
      expect.objectContaining({
        date,
        kind: 'fridge',
        items: expectedItems,
        mealId: null,
        isCooked: false,
      }),
    ])
  })

  it("names a pantry item in the household's language", async () => {
    const household = await world({ locale: 'et' })

    const result = await call(household, {
      date: day(1),
      mealType: 'dinner',
      items: [{ ingredientId: 'ing-peas' }],
    })

    expect(result.items).toEqual([{ name: 'helkherned', source: 'pantry' }])
  })

  it('replaces an empty picker placeholder and returns planned', async () => {
    const household = await world()
    const date = day(1)
    await prisma.mealPlanEntry.create({
      data: { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'dinner' },
    })

    const result = await call(household, { date, mealType: 'dinner', items: [{ label: 'Soup' }] })

    expect(result.outcome).toBe('planned')
    const entries = await dinnerOn(date)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('fridge')
  })

  it('replaces a planned recipe meal with the items and returns replaced', async () => {
    const household = await world()
    const date = day(2)
    await prisma.mealPlanEntry.create({
      data: {
        id: 'entry-planned',
        planId: 'plan-alder',
        date: parseLocalDate(date),
        mealType: 'dinner',
        mealId: 'stew',
        servingOverride: 5,
      },
    })

    const result = await call(household, { date, mealType: 'dinner', items: [{ label: 'Soup' }] })

    expect(result).toEqual({
      outcome: 'replaced',
      date,
      mealType: 'dinner',
      items: [{ name: 'Soup', source: 'text' }],
    })
    const [entry] = await dinnerOn(date)
    expect(entry).toMatchObject({
      id: 'entry-planned',
      kind: 'fridge',
      mealId: null,
      servingOverride: null,
    })
    expect(entry!.items.map((item) => item.label)).toEqual(['Soup'])
  })

  it("replaces a fridge meal's items and returns replaced", async () => {
    const household = await world()
    const date = day(2)
    await call(household, { date, mealType: 'dinner', items: [{ label: 'Soup' }] })

    const result = await call(household, {
      date,
      mealType: 'dinner',
      items: [{ label: 'Bread' }, { ingredientId: 'ing-peas' }],
    })

    expect(result.outcome).toBe('replaced')
    const [entry] = await dinnerOn(date)
    expect(entry!.items.map((item) => item.label ?? item.ingredientId)).toEqual([
      'Bread',
      'ing-peas',
    ])
  })

  describe('refuses and writes nothing', () => {
    it('for a cooked entry', async () => {
      const household = await world()
      const date = day(0)
      await prisma.mealPlanEntry.create({
        data: {
          planId: 'plan-alder',
          date: parseLocalDate(date),
          mealType: 'dinner',
          mealId: 'stew',
          status: 'completed',
        },
      })

      expect(await refusal(household, { date, mealType: 'dinner', items: ITEMS })).toBe(
        `The dinner on ${date} is cooked, so it cannot be changed. Nothing was changed.`,
      )
      const [entry] = await dinnerOn(date)
      expect(entry).toMatchObject({ kind: 'meal', mealId: 'stew', status: 'completed', items: [] })
    })

    it.each([
      ['another household’s ingredient', { ingredientId: 'ing-birch' }],
      ['an unknown ingredient', { ingredientId: 'no-such-ingredient' }],
      ['another household’s entry', { sourceEntryId: 'entry-birch' }],
      ['an unknown entry', { sourceEntryId: 'no-such-entry' }],
    ])('for %s on an empty slot', async (_, item) => {
      const household = await world()
      const date = day(1)

      expect(
        await refusal(household, { date, mealType: 'dinner', items: [{ label: 'Soup' }, item] }),
      ).toContain('is not one this household can use')
      expect(await dinnerOn(date)).toEqual([])
    })

    it('for another household’s ingredient on a planned recipe meal', async () => {
      const household = await world()
      const date = day(1)
      await prisma.mealPlanEntry.create({
        data: {
          planId: 'plan-alder',
          date: parseLocalDate(date),
          mealType: 'dinner',
          mealId: 'stew',
        },
      })

      expect(
        await refusal(household, {
          date,
          mealType: 'dinner',
          items: [{ ingredientId: 'ing-birch' }],
        }),
      ).toContain('is not one this household can use')
      const [entry] = await dinnerOn(date)
      expect(entry).toMatchObject({ kind: 'meal', mealId: 'stew', items: [] })
    })

    it("for yesterday's date", async () => {
      const household = await world()

      expect(
        await refusal(household, { date: day(-1), mealType: 'lunch', items: ITEMS }),
      ).toContain('is in the past')
    })

    it('for a date 29 days ahead', async () => {
      const household = await world()

      expect(
        await refusal(household, { date: day(29), mealType: 'dinner', items: ITEMS }),
      ).toContain('more than 28 days ahead')
      expect(await dinnerOn(day(29))).toEqual([])
    })

    it('for a token without mcp:write, with the reconnect sentence', async () => {
      const household = await world()

      const result = await runTool(
        planFridgeMeal,
        { userId: CALLER.userId, household, scopes: READ_SCOPES },
        { date: day(1), mealType: 'dinner', items: ITEMS },
      )

      expect(result).toEqual({
        isError: true,
        content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
      })
      expect(await dinnerOn(day(1))).toEqual([])
    })
  })
})
