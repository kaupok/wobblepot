import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { findLeftoverProblemForEntry, loadLeftoverSources } from './recent-meals'

// The leftovers a fridge meal can take (HON-1277), for one slot (HON-1396).
// Runs against PGlite through the `unit-db` project, with no mocks.

// The slot asked for: Thursday's lunch.
const LUNCH_22ND = { date: '2026-10-22', mealType: 'lunch' as const }

async function world() {
  await prisma.meal.create({
    data: {
      id: 'meal-mash',
      name: 'Mash',
      translations: { create: { locale: 'et', name: 'Kartulipuder' } },
    },
  })
  await prisma.meal.create({ data: { id: 'meal-soup', name: 'Soup' } })
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  const entry = (
    id: string,
    date: string,
    data: Record<string, unknown> = {},
    planId = 'plan-alder',
  ) =>
    prisma.mealPlanEntry.create({
      data: {
        id,
        planId,
        date: parseLocalDate(date),
        mealType: 'dinner',
        mealId: 'meal-mash',
        status: 'completed',
        ...data,
      },
    })
  await entry('tonight', '2026-10-21', { status: 'planned' })
  await entry('cooked', '2026-10-20')
  await entry('breakfast', '2026-10-22', { mealType: 'breakfast', mealId: 'meal-soup' })
  await entry('three-days', '2026-10-19')
  // Not a source for the 22nd's lunch:
  await entry('four-days', '2026-10-18', { status: 'planned' })
  await entry('after', '2026-10-22', { status: 'planned' })
  await entry('the-lunch', '2026-10-22', { mealType: 'lunch', status: 'planned' })
  await entry('skipped', '2026-10-21', { mealType: 'lunch', status: 'skipped' })
  await entry('fridge', '2026-10-21', { kind: 'fridge', mealId: null, mealType: 'breakfast' })
  await entry('birch', '2026-10-21', { status: 'planned' }, 'plan-birch')
  return { alder: { id: alder.id, locale: null as string | null } }
}

describe('loadLeftoverSources', () => {
  it('lists planned and cooked recipe meals before the slot, up to 3 days back, newest first', async () => {
    const { alder } = await world()

    expect(await loadLeftoverSources(alder, LUNCH_22ND)).toEqual([
      {
        entryId: 'breakfast',
        mealName: 'Soup',
        date: '2026-10-22',
        mealType: 'breakfast',
        sourceState: 'completed',
      },
      {
        entryId: 'tonight',
        mealName: 'Mash',
        date: '2026-10-21',
        mealType: 'dinner',
        sourceState: 'planned',
      },
      {
        entryId: 'cooked',
        mealName: 'Mash',
        date: '2026-10-20',
        mealType: 'dinner',
        sourceState: 'completed',
      },
      {
        entryId: 'three-days',
        mealName: 'Mash',
        date: '2026-10-19',
        mealType: 'dinner',
        sourceState: 'completed',
      },
    ])
  })

  it('counts the window back from the slot, not from today', async () => {
    const { alder } = await world()

    // The 21st's dinner: the same-day lunch is skipped, so the 18th to the 20th.
    const ids = (await loadLeftoverSources(alder, { date: '2026-10-21', mealType: 'dinner' })).map(
      (m) => m.entryId,
    )

    expect(ids).toEqual(['cooked', 'three-days', 'four-days'])
  })

  it("names the meal in the household's language", async () => {
    const { alder } = await world()

    const meals = await loadLeftoverSources({ ...alder, locale: 'et' }, LUNCH_22ND)

    expect(meals.map((m) => m.mealName)).toEqual([
      'Soup',
      'Kartulipuder',
      'Kartulipuder',
      'Kartulipuder',
    ])
  })
})

describe('findLeftoverProblemForEntry', () => {
  it("runs the source rule for the entry's own slot", async () => {
    const { alder } = await world()
    const check = (items: Parameters<typeof findLeftoverProblemForEntry>[2]) =>
      findLeftoverProblemForEntry(alder.id, 'the-lunch', items)

    expect(await check([{ sourceEntryId: 'tonight', servings: 2.5 }])).toBeNull()
    expect(await check([{ sourceEntryId: 'tonight' }])).toEqual({
      sourceEntryId: 'tonight',
      problem: 'servingsRequired',
    })
    expect(await check([{ sourceEntryId: 'after', servings: 1 }])).toEqual({
      sourceEntryId: 'after',
      problem: 'notBefore',
    })
  })

  it("passes when the entry is not the household's, so the write answers 404", async () => {
    await world()

    expect(
      await findLeftoverProblemForEntry('other-household', 'the-lunch', [
        { sourceEntryId: 'after' },
      ]),
    ).toBeNull()
  })
})
