import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { READ_SCOPES } from '@/test/mcp'
import { planFridgeMeal } from './plan-fridge-meal'
import { getMealPlan } from './get-meal-plan'
import {
  CALLER,
  call,
  day,
  dinnerOn,
  ITEMS,
  refusal,
  slot,
  world,
} from './plan-fridge-meal.fixtures'

// Runs against PGlite through the `unit-db` project, with no mocks (HON-1281).

describe('plan_fridge_meal', () => {
  it('plans a fridge meal in an empty slot, and the card and get_meal_plan show its items', async () => {
    const household = await world()
    const date = day(0)

    const result = await call(household, { date, mealType: 'dinner', items: ITEMS })

    const expectedItems = [
      { name: 'glimmer peas', source: 'pantry', sourceEntryId: null, servings: null },
      { name: 'Glimmer stew', source: 'leftover', sourceEntryId: 'entry-cooked', servings: null },
      { name: 'Meatballs', source: 'text', sourceEntryId: null, servings: null },
    ]
    expect(result).toEqual({
      outcome: 'planned',
      status: 'planned',
      date,
      mealType: 'dinner',
      items: expectedItems,
    })
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

    expect(result.items).toEqual([
      { name: 'helkherned', source: 'pantry', sourceEntryId: null, servings: null },
    ])
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
      status: 'planned',
      date,
      mealType: 'dinner',
      items: [{ name: 'Soup', source: 'text', sourceEntryId: null, servings: null }],
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

  describe('on a past day, logs the meal as cooked and leaves the pantry alone', () => {
    async function pantryQuantities(householdId: string) {
      const rows = await prisma.pantryItem.findMany({ where: { householdId } })
      return rows.map((row) => [row.ingredientId, row.quantity])
    }

    it('plans a completed fridge meal in an empty slot', async () => {
      const household = await world()
      await prisma.pantryItem.create({
        data: { householdId: household.id, ingredientId: 'ing-peas', quantity: 200 },
      })
      const date = day(-2)

      const result = await call(household, {
        date,
        mealType: 'dinner',
        items: [{ label: 'Wolt' }, { ingredientId: 'ing-peas' }],
      })

      expect(result).toMatchObject({ outcome: 'planned', status: 'cooked', date })
      const [entry] = await dinnerOn(date)
      expect(entry).toMatchObject({
        kind: 'fridge',
        status: 'completed',
        pantryDeductedAt: expect.any(Date),
      })
      expect(await pantryQuantities(household.id)).toEqual([['ing-peas', 200]])

      const plan = await getMealPlan.run(household, { from: date, to: date }, CALLER)
      expect(plan.entries).toEqual([
        expect.objectContaining({ date, kind: 'fridge', isCooked: true }),
      ])
    })

    it('replaces a planned recipe meal and completes the entry', async () => {
      const household = await world()
      const date = day(-3)
      await prisma.mealPlanEntry.create({
        data: {
          id: 'entry-past-planned',
          planId: 'plan-alder',
          date: parseLocalDate(date),
          mealType: 'dinner',
          mealId: 'stew',
        },
      })

      const result = await call(household, { date, mealType: 'dinner', items: [{ label: 'Wolt' }] })

      expect(result).toMatchObject({ outcome: 'replaced', status: 'cooked' })
      const [entry] = await dinnerOn(date)
      expect(entry).toMatchObject({
        id: 'entry-past-planned',
        kind: 'fridge',
        mealId: null,
        status: 'completed',
        pantryDeductedAt: expect.any(Date),
      })
    })

    it('refuses a cooked slot', async () => {
      const household = await world()
      const date = day(-1)

      expect(await refusal(household, { date, mealType: 'dinner', items: ITEMS })).toBe(
        `The dinner on ${date} is cooked, so it cannot be changed. Nothing was changed.`,
      )
      const [entry] = await dinnerOn(date)
      expect(entry).toMatchObject({ id: 'entry-cooked', kind: 'meal', mealId: 'stew', items: [] })
    })
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
    ])('for %s on an empty slot', async (_, item) => {
      const household = await world()
      const date = day(1)

      expect(
        await refusal(household, { date, mealType: 'dinner', items: [{ label: 'Soup' }, item] }),
      ).toContain('is not one this household can use')
      expect(await dinnerOn(date)).toEqual([])
    })

    it.each([
      ['another household’s cooked entry', 'entry-birch', 'no meal of this household'],
      ['an unknown entry', 'no-such-entry', 'no meal of this household'],
      ['a cooked fridge meal, which has no meal name', 'entry-fridge-cooked', 'not a fridge meal'],
      ['a recipe meal cooked 6 days before the slot', 'entry-old', 'no more than 3 days before'],
    ])('for leftovers of %s', async (_, sourceEntryId, reason) => {
      const household = await world()
      const date = day(2)
      await prisma.mealPlanEntry.createMany({
        data: [
          {
            id: 'entry-fridge-cooked',
            planId: 'plan-alder',
            date: parseLocalDate(day(-1)),
            mealType: 'lunch',
            kind: 'fridge',
            status: 'completed',
          },
          {
            id: 'entry-old',
            planId: 'plan-alder',
            date: parseLocalDate(day(-4)),
            mealType: 'dinner',
            mealId: 'stew',
            status: 'completed',
          },
        ],
      })

      const message = await refusal(household, {
        date,
        mealType: 'dinner',
        items: [{ sourceEntryId }],
      })
      expect(message).toContain(`sourceEntryId ${sourceEntryId}: `)
      expect(message).toContain(reason)
      expect(message).toContain('Nothing was changed.')
      expect(await dinnerOn(date)).toEqual([])
    })

    it("for leftovers of the slot's own planned entry", async () => {
      const household = await world()
      const date = day(1)
      await prisma.mealPlanEntry.create({
        data: {
          id: 'entry-self',
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
          items: [{ sourceEntryId: 'entry-self', servings: 2 }],
        }),
      ).toContain('an earlier slot than this one')
      const [entry] = await dinnerOn(date)
      expect(entry).toMatchObject({ kind: 'meal', mealId: 'stew', items: [] })
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
