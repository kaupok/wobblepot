import { describe, expect, it } from 'vitest'

import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

import { compareLongestSinceCooked, loadMealHistory, type MealHistory } from './meal-history'

// When each recipe was last cooked (HON-1388). Runs against PGlite through the
// `unit-db` project, with no mocks.

const TODAY = '2026-10-28'
const IDS = ['meal-soup', 'meal-trout', 'meal-stew', 'meal-pie']

async function world() {
  for (const [id, name] of [
    ['meal-soup', 'Chicken soup'],
    ['meal-trout', 'Trout'],
    ['meal-stew', 'Stew'],
    ['meal-pie', 'Pie'],
  ] as const) {
    await prisma.meal.create({ data: { id, name } })
  }
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  const entry = (
    mealId: string | null,
    date: string,
    status: 'planned' | 'completed' | 'skipped',
    mealType: 'breakfast' | 'lunch' | 'dinner' = 'dinner',
    planId = 'plan-alder',
  ) =>
    prisma.mealPlanEntry.create({
      data: {
        planId,
        mealId,
        date: parseLocalDate(date),
        mealType,
        status,
        ...(mealId ? {} : { kind: 'fridge' as const }),
      },
    })

  // Soup: cooked 12 days ago; a later skip and an unmarked past entry do not count.
  await entry('meal-soup', '2026-10-16', 'completed')
  await entry('meal-soup', '2026-10-20', 'skipped')
  await entry('meal-soup', '2026-10-25', 'planned', 'lunch')
  // Trout: cooked today and on the window's first day; the day before it and tomorrow do not count.
  await entry('meal-trout', TODAY, 'completed', 'lunch')
  await entry('meal-trout', '2026-10-01', 'completed')
  await entry('meal-trout', '2026-09-30', 'completed')
  await entry('meal-trout', '2026-10-29', 'completed')
  // Stew: never cooked, planned twice ahead; a skipped day ahead is not a plan.
  await entry('meal-stew', '2026-10-29', 'skipped', 'lunch')
  await entry('meal-stew', '2026-11-02', 'planned')
  await entry('meal-stew', '2026-10-31', 'planned')
  // A fridge meal has no recipe and no history.
  await entry(null, '2026-10-27', 'completed')
  // Birch cooked and planned the soup too.
  await entry('meal-soup', '2026-10-27', 'completed', 'dinner', 'plan-birch')
  await entry('meal-soup', '2026-10-30', 'planned', 'dinner', 'plan-birch')

  return { alder: alder.id }
}

describe('loadMealHistory', () => {
  it("returns each meal's last cooked day, 4-week count and next planned day", async () => {
    const { alder } = await world()

    const history = await loadMealHistory(alder, IDS, TODAY)

    expect(Object.fromEntries(history)).toEqual({
      'meal-soup': { lastCookedOn: '2026-10-16', cookedLast28Days: 1, nextPlannedOn: null },
      'meal-trout': { lastCookedOn: '2026-10-28', cookedLast28Days: 2, nextPlannedOn: null },
      'meal-stew': { lastCookedOn: null, cookedLast28Days: 0, nextPlannedOn: '2026-10-31' },
    })
  })

  it('leaves out a meal with no entries', async () => {
    const { alder } = await world()

    expect((await loadMealHistory(alder, IDS, TODAY)).has('meal-pie')).toBe(false)
  })

  it('counts a planned entry for today as the next planned day', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-alder',
        mealId: 'meal-stew',
        date: parseLocalDate(TODAY),
        mealType: 'dinner',
      },
    })

    expect((await loadMealHistory(alder, ['meal-stew'], TODAY)).get('meal-stew')).toEqual({
      lastCookedOn: null,
      cookedLast28Days: 0,
      nextPlannedOn: TODAY,
    })
  })

  it('reads nothing for no meals', async () => {
    const { alder } = await world()

    expect((await loadMealHistory(alder, [], TODAY)).size).toBe(0)
  })
})

describe('compareLongestSinceCooked', () => {
  const h = (lastCookedOn: string | null, nextPlannedOn: string | null = null): MealHistory => ({
    lastCookedOn,
    cookedLast28Days: 0,
    nextPlannedOn,
  })

  it('puts the oldest cooked first, then never cooked, then planned', () => {
    const meals = {
      planned: h('2026-09-01', '2026-10-30'),
      never: h(null),
      recent: h('2026-10-27'),
      oldest: h('2026-08-15'),
    }

    const order = Object.entries(meals)
      .sort(([, a], [, b]) => compareLongestSinceCooked(a, b))
      .map(([name]) => name)

    expect(order).toEqual(['oldest', 'recent', 'never', 'planned'])
  })

  it('ties two meals cooked on the same day', () => {
    expect(compareLongestSinceCooked(h('2026-10-01'), h('2026-10-01'))).toBe(0)
  })
})
