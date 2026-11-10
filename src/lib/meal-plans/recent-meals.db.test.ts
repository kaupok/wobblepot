import { describe, expect, it } from 'vitest'

import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

import {
  CHANGED_SOURCE_PROBLEMS,
  findLeftoverProblemForEntry,
  findLeftoverSourceProblem,
  loadLeftoverSources,
} from './recent-meals'

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

  // Nobody cooks a breakfast to eat it again (HON-1524).
  it('lists no breakfast, planned or cooked, and keeps the dinners newest first', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.deleteMany({ where: { planId: 'plan-alder' } })
    const entry = (
      id: string,
      date: string,
      mealType: 'breakfast' | 'dinner',
      status: 'planned' | 'completed',
    ) =>
      prisma.mealPlanEntry.create({
        data: {
          id,
          planId: 'plan-alder',
          date: parseLocalDate(date),
          mealType,
          mealId: 'meal-mash',
          status,
        },
      })
    await entry('thu-breakfast', '2026-10-22', 'breakfast', 'planned')
    await entry('wed-breakfast', '2026-10-21', 'breakfast', 'completed')
    await entry('wed-dinner', '2026-10-21', 'dinner', 'completed')
    await entry('tue-dinner', '2026-10-20', 'dinner', 'planned')

    const ids = (await loadLeftoverSources(alder, LUNCH_22ND)).map((m) => m.entryId)

    expect(ids).toEqual(['wed-dinner', 'tue-dinner'])
  })

  it('lists a lunch before the slot', async () => {
    const { alder } = await world()

    const sources = await loadLeftoverSources(alder, { date: '2026-10-22', mealType: 'dinner' })

    expect(sources[0]).toEqual({
      entryId: 'the-lunch',
      mealName: 'Mash',
      date: '2026-10-22',
      mealType: 'lunch',
      sourceState: 'planned',
    })
    expect(sources.map((m) => m.entryId)).not.toContain('breakfast')
  })

  it("names the meal in the household's language", async () => {
    const { alder } = await world()

    const meals = await loadLeftoverSources({ ...alder, locale: 'et' }, LUNCH_22ND)

    expect(meals.map((m) => m.mealName)).toEqual(['Kartulipuder', 'Kartulipuder', 'Kartulipuder'])
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

// The picker lists no breakfast, but the save still takes one (HON-1524): the
// MCP `plan_fridge_meal` and the entry routes run this rule.
describe('findLeftoverSourceProblem with a breakfast source', () => {
  it('passes a new breakfast source', async () => {
    const { alder } = await world()

    expect(
      await findLeftoverSourceProblem(alder.id, LUNCH_22ND, [{ sourceEntryId: 'breakfast' }]),
    ).toBeNull()
  })

  it('passes a breakfast item the fridge meal already stores', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({
      where: { id: 'the-lunch' },
      data: {
        kind: 'fridge',
        mealId: null,
        items: { create: { position: 0, sourceEntryId: 'breakfast' } },
      },
    })

    expect(
      await findLeftoverProblemForEntry(alder.id, 'the-lunch', [{ sourceEntryId: 'breakfast' }]),
    ).toBeNull()
  })
})

// Undo after Clear sends a lunch's own items back (HON-1396).
describe('findLeftoverSourceProblem with CHANGED_SOURCE_PROBLEMS', () => {
  it('passes what a change to the source causes, and nothing else', async () => {
    const { alder } = await world()
    const restore = (items: Parameters<typeof findLeftoverSourceProblem>[2]) =>
      findLeftoverSourceProblem(alder.id, LUNCH_22ND, items, CHANGED_SOURCE_PROBLEMS)

    // Planned with no servings, skipped since, a fridge meal now, and older
    // than a window rule that moved past it (HON-1451): all pass.
    expect(
      await restore([
        { sourceEntryId: 'tonight' },
        { sourceEntryId: 'skipped' },
        { sourceEntryId: 'fridge' },
        { sourceEntryId: 'four-days' },
      ]),
    ).toBeNull()
    // A source after the slot never passed the rule.
    expect(await restore([{ sourceEntryId: 'tonight' }, { sourceEntryId: 'after' }])).toEqual({
      sourceEntryId: 'after',
      problem: 'notBefore',
    })
  })

  it('still refuses a too-old source on a new fridge meal (HON-1451)', async () => {
    const { alder } = await world()

    expect(
      await findLeftoverSourceProblem(alder.id, LUNCH_22ND, [{ sourceEntryId: 'four-days' }]),
    ).toEqual({ sourceEntryId: 'four-days', problem: 'tooOld' })
  })
})
