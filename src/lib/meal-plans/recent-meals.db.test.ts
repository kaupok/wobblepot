import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { loadRecentMeals } from './recent-meals'

// The leftovers a fridge meal can take (HON-1277). Runs against PGlite through
// the `unit-db` project, with no mocks.

// 23:30 on 21 October in Tallinn (UTC+3), still the 21st in UTC too, and
// 00:30 on the 22nd in Tallinn: the household's day decides which is "today".
const LATE_ON_21ST = new Date('2026-10-21T20:30:00Z')
const AFTER_MIDNIGHT_22ND = new Date('2026-10-21T21:30:00Z')
const TZ = 'Europe/Tallinn'

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
    data: { name: 'Alder', timezone: TZ, mealPlans: { create: { id: 'plan-alder' } } },
  })
  await prisma.household.create({
    data: { name: 'Birch', timezone: TZ, mealPlans: { create: { id: 'plan-birch' } } },
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
  await entry('day-0', '2026-10-21', { mealType: 'lunch', mealId: 'meal-soup' })
  await entry('day-1', '2026-10-20')
  await entry('day-3', '2026-10-18')
  await entry('day-4', '2026-10-17')
  await entry('planned', '2026-10-19', { status: 'planned' })
  await entry('skipped', '2026-10-19', { status: 'skipped', mealType: 'lunch' })
  await entry('fridge', '2026-10-19', { kind: 'fridge', mealId: null, mealType: 'breakfast' })
  // Tomorrow on the 21st, today on the 22nd.
  await entry('the-22nd', '2026-10-22')
  await entry('birch', '2026-10-20', {}, 'plan-birch')
  return { alder: { id: alder.id, timezone: TZ, locale: null as string | null } }
}

describe('loadRecentMeals', () => {
  it('lists completed recipe meals from today back 3 days, newest first, and no others', async () => {
    const { alder } = await world()

    expect(await loadRecentMeals(alder, LATE_ON_21ST)).toEqual([
      { entryId: 'day-0', mealName: 'Soup', date: '2026-10-21' },
      { entryId: 'day-1', mealName: 'Mash', date: '2026-10-20' },
      { entryId: 'day-3', mealName: 'Mash', date: '2026-10-18' },
    ])
  })

  it("moves the window at the household's midnight, not the server's", async () => {
    const { alder } = await world()

    const ids = (await loadRecentMeals(alder, AFTER_MIDNIGHT_22ND)).map((m) => m.entryId)

    // The 22nd's window is the 19th to the 22nd: day 3 drops out, the 22nd is in.
    expect(ids).toEqual(['the-22nd', 'day-0', 'day-1'])
  })

  it("names the meal in the household's language", async () => {
    const { alder } = await world()

    const meals = await loadRecentMeals({ ...alder, locale: 'et' }, LATE_ON_21ST)

    expect(meals.map((m) => m.mealName)).toEqual(['Soup', 'Kartulipuder', 'Kartulipuder'])
  })
})
