import { describe, expect, it } from 'vitest'

import { listHouseholdMeals } from '@/lib/household-meals-read'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

// The cook history on each My recipes row (HON-1389). Runs against PGlite
// through the `unit-db` project, with no mocks. `loadMealHistory` has its own
// edge cases in `meal-plans/meal-history.db.test.ts`; this file proves the
// list carries them.

const TODAY = '2026-10-28'

async function world() {
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  for (const id of ['meal-soup', 'meal-stew', 'meal-pie']) {
    await prisma.meal.create({ data: { id, name: id, householdId: alder.id } })
  }
  const entry = (mealId: string, date: string, status: 'planned' | 'completed') =>
    prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-alder',
        mealId,
        date: parseLocalDate(date),
        mealType: 'dinner',
        status,
      },
    })

  // Soup: cooked 3 times in the 4 weeks, last 12 days ago.
  await entry('meal-soup', '2026-10-16', 'completed')
  await entry('meal-soup', '2026-10-09', 'completed')
  await entry('meal-soup', '2026-10-02', 'completed')
  // Stew: never cooked, planned on Saturday.
  await entry('meal-stew', '2026-10-31', 'planned')

  return { alder: alder.id }
}

describe('listHouseholdMeals cook history', () => {
  it('gives each row its last cooked day, 4-week count and next planned day', async () => {
    const { alder } = await world()

    const { meals } = await listHouseholdMeals({ householdId: alder, locale: 'en', today: TODAY })
    const byId = Object.fromEntries(
      meals.map(({ id, lastCookedOn, cookedLast28Days, nextPlannedOn }) => [
        id,
        { lastCookedOn, cookedLast28Days, nextPlannedOn },
      ]),
    )

    expect(byId).toEqual({
      'meal-soup': { lastCookedOn: '2026-10-16', cookedLast28Days: 3, nextPlannedOn: null },
      'meal-stew': { lastCookedOn: null, cookedLast28Days: 0, nextPlannedOn: '2026-10-31' },
      'meal-pie': { lastCookedOn: null, cookedLast28Days: 0, nextPlannedOn: null },
    })
  })
})
