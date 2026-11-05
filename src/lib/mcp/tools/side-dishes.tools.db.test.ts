import { describe, expect, it, vi } from 'vitest'

import { ToolInputError } from '@/lib/mcp/context'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

import { clearMeal } from './clear-meal'
import { getMeal } from './get-meal'
import { getMealPlan } from './get-meal-plan'
import { loadChangeableEntry } from './meal-changes'
import { CALLER, day, world } from './plan-fridge-meal.fixtures'
import { planMeal } from './plan-meal'
import { rateMeal } from './rate-meal'
import { setMealServings } from './set-meal-servings'
import { setMealStatus } from './set-meal-status'
import { swapMeal } from './swap-meal'

// The tools import modules that call `after()`, and the `unit-db` project
// shares one module cache (HON-1586).
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))

// HON-1610: the assistant adds a side with `plan_meal` role side, and the slot
// tools act on a side by its `entryId`. Runs against PGlite through the
// `unit-db` project, with no mocks of the database.

type Household = Awaited<ReturnType<typeof world>>

interface Tool<I, O> {
  inputSchema: { parse: (input: unknown) => I }
  run: (household: Household, input: I, caller: typeof CALLER) => Promise<O>
}

const run = <I, O>(tool: Tool<I, O>, household: Household, input: Record<string, unknown>) =>
  tool.run(household, tool.inputSchema.parse(input), CALLER)

async function refusal<I, O>(
  tool: Tool<I, O>,
  household: Household,
  input: Record<string, unknown>,
) {
  const error = await run(tool, household, input).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ToolInputError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.message
}

const TOMORROW = day(1)
const SLOT = { date: TOMORROW, mealType: 'dinner' }

/** The fixtures' world, plus a salad and a slaw, and tomorrow's stew dinner at 4 servings. */
async function sidesWorld() {
  const household = await world()
  for (const [id, name] of [
    ['salad', 'Cucumber salad'],
    ['slaw', 'Cabbage slaw'],
  ] as const) {
    await prisma.meal.create({ data: { id, name, suitableFor: ['dinner'], course: 'side' } })
  }
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-main',
      planId: 'plan-alder',
      date: parseLocalDate(TOMORROW),
      mealType: 'dinner',
      mealId: 'stew',
      servingOverride: 4,
    },
  })
  return household
}

async function withSalad() {
  const household = await sidesWorld()
  const added = await run(planMeal, household, { ...SLOT, mealId: 'salad', role: 'side' })
  return { household, sideId: added.entryId }
}

const read = (id: string) => prisma.mealPlanEntry.findUnique({ where: { id } })

describe('plan_meal role side', () => {
  it('adds a side to a planned recipe main, at the main’s servings, and get_meal_plan lists it', async () => {
    const household = await sidesWorld()

    const result = await run(planMeal, household, { ...SLOT, mealId: 'salad', role: 'side' })

    expect(result).toMatchObject({ outcome: 'planned', role: 'side', status: 'planned' })
    const plan = await run(getMealPlan, household, { from: TOMORROW, to: TOMORROW })
    expect(plan.entries).toEqual([
      expect.objectContaining({
        entryId: 'entry-main',
        sides: [
          {
            entryId: result.entryId,
            mealId: 'salad',
            mealName: 'Cucumber salad',
            servings: 4,
            cookServings: 4,
            status: 'planned',
            rating: null,
          },
        ],
      }),
    ])
  })

  it('adds a side to a fridge meal', async () => {
    const household = await sidesWorld()
    await prisma.mealPlanEntry.create({
      data: {
        id: 'entry-fridge',
        planId: 'plan-alder',
        date: parseLocalDate(day(2)),
        mealType: 'dinner',
        kind: 'fridge',
      },
    })

    const result = await run(planMeal, household, {
      date: day(2),
      mealType: 'dinner',
      mealId: 'salad',
      role: 'side',
    })

    expect((await read(result.entryId))?.mainEntryId).toBe('entry-fridge')
  })

  it('logs a side of a cooked main as cooked, and leaves the pantry alone', async () => {
    const household = await sidesWorld()
    await prisma.pantryItem.create({
      data: { householdId: household.id, ingredientId: 'ing-peas', quantity: 500 },
    })

    const result = await run(planMeal, household, {
      date: day(-1),
      mealType: 'dinner',
      mealId: 'salad',
      role: 'side',
      servings: 2,
    })

    expect(result.status).toBe('cooked')
    expect(await read(result.entryId)).toMatchObject({ status: 'completed', cookedServings: 2 })
    expect(
      await prisma.pantryItem.findMany({ select: { ingredientId: true, quantity: true } }),
    ).toEqual([{ ingredientId: 'ing-peas', quantity: 500 }])
  })

  it('refuses an empty slot, a note-only slot, a skipped main and a meal already in the slot', async () => {
    const household = await sidesWorld()
    const side = (input: Record<string, unknown>) =>
      refusal(planMeal, household, { mealId: 'salad', role: 'side', mealType: 'dinner', ...input })

    expect(await side({ date: day(3) })).toContain('Plan the main first')

    await prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-alder',
        date: parseLocalDate(day(4)),
        mealType: 'dinner',
        note: 'Pizza night',
      },
    })
    expect(await side({ date: day(4) })).toContain('Plan the main first')

    expect(await side({ date: TOMORROW, mealId: 'stew' })).toContain(
      'Glimmer stew is already in this slot',
    )

    await prisma.mealPlanEntry.update({ where: { id: 'entry-main' }, data: { status: 'skipped' } })
    expect(await side({ date: TOMORROW })).toContain('This slot was skipped')

    expect(await prisma.mealPlanEntry.count({ where: { mainEntryId: { not: null } } })).toBe(0)
  })
})

describe('the slot tools with entryId', () => {
  it('set_meal_servings sets the main without entryId, and the side with it', async () => {
    const { household, sideId } = await withSalad()

    await run(setMealServings, household, { ...SLOT, servings: 6 })
    const side = await run(setMealServings, household, { ...SLOT, entryId: sideId, servings: 2 })

    expect(side.meal).toEqual({ id: 'salad', name: 'Cucumber salad' })
    expect((await read('entry-main'))?.servingOverride).toBe(6)
    expect((await read(sideId))?.servingOverride).toBe(2)
  })

  it('set_meal_status refuses a side before its main, then cooks the slot from the main, and rate_meal rates the side', async () => {
    const { household, sideId } = await withSalad()

    expect(
      await refusal(setMealStatus, household, { ...SLOT, entryId: sideId, status: 'cooked' }),
    ).toContain('Mark the main meal cooked first')
    expect((await read(sideId))?.status).toBe('planned')

    await run(setMealStatus, household, { ...SLOT, status: 'cooked' })
    expect((await read(sideId))?.status).toBe('completed')

    await run(rateMeal, household, { ...SLOT, entryId: sideId, rating: 'up' })
    expect((await read(sideId))?.rating).toBe('up')
    expect((await read('entry-main'))?.rating).toBeNull()

    await run(setMealStatus, household, { ...SLOT, status: 'planned' })
    expect((await read(sideId))?.status).toBe('planned')
  })

  it('swap_meal swaps the side by entryId, keeps the sides on a main swap, and refuses a meal already in the slot', async () => {
    const { household, sideId } = await withSalad()

    await run(swapMeal, household, { ...SLOT, entryId: sideId, mealId: 'slaw' })
    expect((await read(sideId))?.mealId).toBe('slaw')
    expect((await read('entry-main'))?.mealId).toBe('stew')

    expect(await refusal(swapMeal, household, { ...SLOT, mealId: 'slaw' })).toContain(
      'Remove the side first',
    )

    await prisma.meal.create({ data: { id: 'soup', name: 'Soup', suitableFor: ['dinner'] } })
    const swapped = await run(swapMeal, household, { ...SLOT, mealId: 'soup' })
    expect(swapped.keptSides).toEqual([{ id: 'slaw', name: 'Cabbage slaw' }])
    expect((await read(sideId))?.mainEntryId).toBe('entry-main')
  })

  it('swap_meal moves the sides with the main: logged on a past day, planned again out of skipped', async () => {
    const household = await sidesWorld()
    await prisma.meal.create({ data: { id: 'soup', name: 'Soup', suitableFor: ['dinner'] } })
    await prisma.mealPlanEntry.create({
      data: {
        id: 'entry-past',
        planId: 'plan-alder',
        date: parseLocalDate(day(-2)),
        mealType: 'dinner',
        mealId: 'stew',
      },
    })
    const past = { date: day(-2), mealType: 'dinner' }
    const pastSide = await run(planMeal, household, { ...past, mealId: 'salad', role: 'side' })
    expect(pastSide.status).toBe('planned')

    await run(swapMeal, household, { ...past, mealId: 'soup' })

    const logged = await read(pastSide.entryId)
    // The fixture household's two adults: the main's override was reset by the swap.
    expect(logged).toMatchObject({ status: 'completed', cookedServings: 2 })
    expect(logged?.pantryDeductedAt).not.toBeNull()
  })

  it('swap_meal plans the sides again when it swaps a skipped main', async () => {
    const { household, sideId } = await withSalad()
    await run(setMealStatus, household, { ...SLOT, status: 'skipped' })
    expect((await read(sideId))?.status).toBe('skipped')
    await prisma.meal.create({ data: { id: 'soup', name: 'Soup', suitableFor: ['dinner'] } })

    await run(swapMeal, household, { ...SLOT, mealId: 'soup' })

    expect((await read('entry-main'))?.status).toBe('planned')
    expect((await read(sideId))?.status).toBe('planned')
  })

  it('get_meal reads a side by its mealId, with and without entryId', async () => {
    const { household, sideId } = await withSalad()

    const bare = await run(getMeal, household, { ...SLOT, mealId: 'salad' })
    const named = await run(getMeal, household, { ...SLOT, mealId: 'salad', entryId: sideId })

    expect(bare.meal).toMatchObject({ id: 'salad', course: 'side', servings: 4 })
    expect(named.meal).toMatchObject({ id: 'salad', course: 'side' })
  })

  it('change_meal_ingredients and adjust_meal load the side by entryId', async () => {
    const { household, sideId } = await withSalad()

    const main = await loadChangeableEntry(household, TOMORROW, 'dinner', 'en')
    const side = await loadChangeableEntry(household, TOMORROW, 'dinner', 'en', sideId)

    expect(main.slot.id).toBe('entry-main')
    expect(side.slot).toMatchObject({ id: sideId, mealId: 'salad' })
  })

  it('clear_meal removes only the side with its entryId, and the whole slot without it', async () => {
    const { household, sideId } = await withSalad()
    const slaw = await run(planMeal, household, { ...SLOT, mealId: 'slaw', role: 'side' })

    const one = await run(clearMeal, household, { ...SLOT, entryId: sideId })
    expect(one.removedSides).toEqual([])
    expect(await read(sideId)).toBeNull()
    expect(await read('entry-main')).not.toBeNull()

    const all = await run(clearMeal, household, SLOT)
    expect(all.removedSides).toEqual([{ id: 'slaw', name: 'Cabbage slaw' }])
    expect(await read(slaw.entryId)).toBeNull()
    expect(await read('entry-main')).toBeNull()
  })

  it('refuses an entryId from another slot, and changes nothing', async () => {
    const { household } = await withSalad()

    for (const [tool, input] of [
      [clearMeal, {}],
      [setMealServings, { servings: 2 }],
      [setMealStatus, { status: 'skipped' }],
      [rateMeal, { rating: 'up' }],
      [swapMeal, { mealId: 'slaw' }],
      [getMeal, { mealId: 'stew' }],
    ] as const) {
      expect(
        await refusal(tool as Tool<unknown, unknown>, household, {
          ...SLOT,
          entryId: 'entry-cooked',
          ...input,
        }),
      ).toContain('is not the dinner')
    }
    // change_meal_ingredients and adjust_meal resolve the entry here.
    await expect(
      loadChangeableEntry(household, TOMORROW, 'dinner', 'en', 'entry-cooked'),
    ).rejects.toThrow('is not the dinner')
    expect(await read('entry-cooked')).toMatchObject({
      mealId: 'stew',
      servingOverride: null,
      status: 'completed',
      rating: null,
    })
    expect(await read('entry-main')).toMatchObject({ mealId: 'stew', servingOverride: 4 })
  })
})
