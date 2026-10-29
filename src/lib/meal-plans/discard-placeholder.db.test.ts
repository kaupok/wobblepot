import { describe, expect, it } from 'vitest'

import { discardPlaceholder } from '@/lib/meal-plans/discard-placeholder'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project, with no mocks: rows are
// written with Prisma and deleted through `discardPlaceholder` (HON-1251).

/**
 * Alder's plan has a placeholder breakfast, a fish dinner and a note-only
 * lunch; Birch has its own placeholder.
 */
async function world() {
  await prisma.meal.create({ data: { id: 'meal-fish', name: 'Fish tacos' } })
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  const date = new Date('2026-10-14T00:00:00Z')
  await prisma.mealPlanEntry.createMany({
    data: [
      { id: 'entry-placeholder', planId: 'plan-alder', date, mealType: 'breakfast' },
      { id: 'entry-dinner', planId: 'plan-alder', date, mealType: 'dinner', mealId: 'meal-fish' },
      { id: 'entry-note', planId: 'plan-alder', date, mealType: 'lunch', note: 'Eating out' },
      { id: 'entry-birch', planId: 'plan-birch', date, mealType: 'dinner' },
    ],
  })
  return { alder }
}

const exists = async (id: string) =>
  (await prisma.mealPlanEntry.findUnique({ where: { id } })) !== null

describe('discardPlaceholder', () => {
  it('deletes an entry with no meal and no note', async () => {
    const { alder } = await world()

    expect(await discardPlaceholder(alder.id, 'plan-alder', 'entry-placeholder')).toBe(true)
    expect(await exists('entry-placeholder')).toBe(false)
  })

  // The pick landed before the discard sent as the page unloaded.
  it('keeps an entry that has a meal', async () => {
    const { alder } = await world()

    expect(await discardPlaceholder(alder.id, 'plan-alder', 'entry-dinner')).toBe(false)
    expect(await exists('entry-dinner')).toBe(true)
  })

  it('keeps an entry that has a note', async () => {
    const { alder } = await world()

    expect(await discardPlaceholder(alder.id, 'plan-alder', 'entry-note')).toBe(false)
    expect(await exists('entry-note')).toBe(true)
  })

  it("keeps another household's placeholder", async () => {
    const { alder } = await world()

    expect(await discardPlaceholder(alder.id, 'plan-birch', 'entry-birch')).toBe(false)
    expect(await exists('entry-birch')).toBe(true)
  })
})
