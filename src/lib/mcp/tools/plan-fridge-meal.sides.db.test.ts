import { describe, expect, it, vi } from 'vitest'

import { parseLocalDate } from '@/lib/meal-planning/dates'
import { FridgeItemNotFoundError, setFridgeItems } from '@/lib/meal-plans/fridge-meal'
import { addLeftoverLunch, LeftoverLunchError } from '@/lib/meal-plans/leftover-lunch'
import { loadLeftoverSources } from '@/lib/meal-plans/recent-meals'
import { prisma } from '@/lib/prisma'

import { call, day, refusal, world } from './plan-fridge-meal.fixtures'

// As in `plan-fridge-meal.db.test.ts`: `create_meal` starts its image in
// `after()`, and the `unit-db` project shares one module cache (HON-1586).
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))

// Only a main gives leftovers, and a fridge change of the main keeps its sides
// (HON-1609). Runs against PGlite through the `unit-db` project, with no mocks.

/**
 * The fixtures' world, plus a salad side on yesterday's cooked stew dinner, and
 * tonight's planned stew dinner with a salad side of its own. Each main's date
 * is moved away and back after its side is written, so a read with no order and
 * no `mainEntryId` filter meets the side first.
 */
async function sidesWorld() {
  const household = await world()
  await prisma.meal.create({ data: { id: 'salad', name: 'Cucumber salad' } })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-tonight',
      planId: 'plan-alder',
      date: parseLocalDate(day(0)),
      mealType: 'dinner',
      mealId: 'stew',
    },
  })
  for (const [main, status, date] of [
    ['entry-cooked', 'completed', day(-1)],
    ['entry-tonight', 'planned', day(0)],
  ] as const) {
    await prisma.mealPlanEntry.create({
      data: {
        id: `${main}-side`,
        planId: 'plan-alder',
        date: parseLocalDate(date),
        mealType: 'dinner',
        mealId: 'salad',
        mainEntryId: main,
        status,
      },
    })
    await prisma.mealPlanEntry.update({
      where: { id: main },
      data: { date: parseLocalDate(day(300)) },
    })
    await prisma.mealPlanEntry.update({ where: { id: main }, data: { date: parseLocalDate(date) } })
  }
  return household
}

const lunches = () =>
  prisma.mealPlanEntry.findMany({ where: { planId: 'plan-alder', mealType: 'lunch' } })

describe('side dishes and leftovers (HON-1609)', () => {
  it('loadLeftoverSources lists the mains, not their sides', async () => {
    const household = await sidesWorld()

    const sources = await loadLeftoverSources(household, { date: day(1), mealType: 'lunch' })

    expect(sources.map((source) => source.entryId)).toEqual(['entry-tonight', 'entry-cooked'])
  })

  it("plan_fridge_meal refuses a side's entry as the source and changes nothing", async () => {
    const household = await sidesWorld()

    const message = await refusal(household, {
      date: day(0),
      mealType: 'lunch',
      items: [{ sourceEntryId: 'entry-cooked-side' }],
    })

    expect(message).toBe(
      "sourceEntryId entry-cooked-side: that entry is a side dish, and only a slot's main meal gives leftovers. Use the main meal's entryId. Nothing was changed.",
    )
    expect(await lunches()).toEqual([])
  })

  it('plan_fridge_meal on a main with a side makes the main a fridge meal and keeps the side', async () => {
    const household = await sidesWorld()

    const result = await call(household, {
      date: day(0),
      mealType: 'dinner',
      items: [{ label: 'Meatballs' }],
    })

    expect(result).toMatchObject({ outcome: 'replaced', items: [{ name: 'Meatballs' }] })
    const slot = await prisma.mealPlanEntry.findMany({
      where: { planId: 'plan-alder', date: parseLocalDate(day(0)), mealType: 'dinner' },
      select: { id: true, kind: true, mealId: true, mainEntryId: true },
      orderBy: { id: 'asc' },
    })
    expect(slot).toEqual([
      { id: 'entry-tonight', kind: 'fridge', mealId: null, mainEntryId: null },
      { id: 'entry-tonight-side', kind: 'meal', mealId: 'salad', mainEntryId: 'entry-tonight' },
    ])
  })

  it("setFridgeItems refuses a side's entry as the source", async () => {
    const household = await sidesWorld()

    const error = await setFridgeItems(household.id, 'plan-alder', 'entry-tonight', [
      { sourceEntryId: 'entry-cooked-side' },
    ]).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FridgeItemNotFoundError)
    expect(
      await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'entry-tonight' } }),
    ).toMatchObject({ kind: 'meal', mealId: 'stew' })
  })

  it('"Cook for tomorrow\'s lunch too" refuses a side as the dinner', async () => {
    const household = await sidesWorld()

    const error = await addLeftoverLunch(household, 'plan-alder', 'entry-tonight-side', 2).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(LeftoverLunchError)
    expect((error as LeftoverLunchError).reason).toBe('notPlannedDinner')
    expect(await lunches()).toEqual([])
  })
})
