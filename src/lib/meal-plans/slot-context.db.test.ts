import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { loadSlotEntry } from '@/lib/meal-plans/slot-context'

// Runs against PGlite through the `unit-db` project, with no mocks: rows are
// written with Prisma and read through `loadSlotEntry` (HON-1206).

/** Alder's plan has a fish dinner and an empty lunch; Birch has its own plan and entry. */
async function world() {
  await prisma.meal.create({
    data: { id: 'meal-fish', name: 'Fish tacos', timeMinutes: 25, primaryProteinType: 'fish' },
  })
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  const date = new Date('2026-10-14T00:00:00Z')
  await prisma.mealPlanEntry.createMany({
    data: [
      { id: 'entry-dinner', planId: 'plan-alder', date, mealType: 'dinner', mealId: 'meal-fish' },
      { id: 'entry-lunch', planId: 'plan-alder', date, mealType: 'lunch' },
      { id: 'entry-birch', planId: 'plan-birch', date, mealType: 'dinner' },
    ],
  })
  return { alder, birch }
}

describe('loadSlotEntry', () => {
  it('returns an entry with the meal fields a swap ranks against', async () => {
    const { alder } = await world()

    expect(await loadSlotEntry(alder.id, 'plan-alder', 'entry-dinner')).toEqual({
      id: 'entry-dinner',
      planId: 'plan-alder',
      date: new Date('2026-10-14T00:00:00Z'),
      mealType: 'dinner',
      mealId: 'meal-fish',
      meal: { id: 'meal-fish', timeMinutes: 25, primaryProteinType: 'fish' },
    })
  })

  it('returns an empty slot with no meal', async () => {
    const { alder } = await world()

    expect(await loadSlotEntry(alder.id, 'plan-alder', 'entry-lunch')).toMatchObject({
      id: 'entry-lunch',
      mealType: 'lunch',
      mealId: null,
      meal: null,
    })
  })

  it("answers null for another household's entry", async () => {
    const { alder, birch } = await world()

    expect(await loadSlotEntry(alder.id, 'plan-birch', 'entry-birch')).toBeNull()
    expect(await loadSlotEntry(birch.id, 'plan-alder', 'entry-dinner')).toBeNull()
  })

  // The household and the entry match, so only the plan filter refuses it.
  it('answers null when the URL names a plan the entry is not in', async () => {
    const { alder } = await world()

    expect(await loadSlotEntry(alder.id, 'plan-birch', 'entry-dinner')).toBeNull()
  })
})
