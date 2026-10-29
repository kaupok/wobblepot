import { describe, expect, it } from 'vitest'

import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

import { loadSlotCandidates, suggestForSlot } from './slot-suggestions'

// A family plans from a rotation of its usual meals on purpose, so a meal
// planned recently stays in the suggestions (HON-1393). Runs against PGlite
// through the `unit-db` project, with no mocks, so the plan entries are real
// rows. The jitter stays real: it is smaller than any score signal, so it only
// reorders meals that are already tied.

function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone('UTC'))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

const OWN = ['own-1', 'own-2', 'own-3', 'own-4', 'own-5', 'own-6']
const SHARED = ['shared-1', 'shared-2', 'shared-3', 'shared-4', 'shared-5', 'shared-6']

/**
 * Rowan has 6 own dinners, each planned on one of the last 6 days, and an
 * empty dinner slot tomorrow. 6 shared dinners have the same score signals
 * otherwise: no favourite, rating, pantry match or kid-friendly flag.
 */
async function world() {
  const rowan = await prisma.household.create({
    data: { name: 'Rowan', mealPlans: { create: { id: 'plan-rowan' } } },
  })
  for (const id of OWN) {
    await prisma.meal.create({
      data: { id, name: `Rowan ${id}`, suitableFor: ['dinner'], householdId: rowan.id },
    })
  }
  for (const id of SHARED) {
    await prisma.meal.create({ data: { id, name: `Shared ${id}`, suitableFor: ['dinner'] } })
  }
  for (const [index, mealId] of OWN.entries()) {
    await prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-rowan',
        date: parseLocalDate(day(-(index + 1))),
        mealType: 'dinner',
        mealId,
        status: 'completed',
      },
    })
  }
  const slot = await prisma.mealPlanEntry.create({
    data: { planId: 'plan-rowan', date: parseLocalDate(day(1)), mealType: 'dinner' },
  })
  return { household: { id: rowan.id, preferences: null }, slotId: slot.id }
}

describe('slot suggestions and recent history', () => {
  it('keeps a household recipe planned 3 days before the slot', async () => {
    const { household, slotId } = await world()

    const pool = await loadSlotCandidates(
      household,
      { id: slotId, mealType: 'dinner', mealId: null },
      'add',
    )

    expect(pool.map((meal) => meal.id)).toContain('own-3')
  })

  it('ranks 6 own recipes, all planned in the last 14 days, above shared ones', async () => {
    const { household, slotId } = await world()

    const pool = await loadSlotCandidates(
      household,
      { id: slotId, mealType: 'dinner', mealId: null },
      'add',
    )
    const suggestions = await suggestForSlot(
      household,
      { id: slotId, mealType: 'dinner', mealId: null },
      'add',
      'en',
    )

    expect(
      pool
        .slice(0, 6)
        .map((meal) => meal.id)
        .sort(),
    ).toEqual(OWN)
    expect(suggestions).toHaveLength(3)
    for (const meal of suggestions) expect(OWN).toContain(meal.id)
  })

  it("leaves the slot's own meal out of a swap's suggestions", async () => {
    const { household } = await world()
    const entry = await prisma.mealPlanEntry.create({
      data: {
        planId: 'plan-rowan',
        date: parseLocalDate(day(2)),
        mealType: 'dinner',
        mealId: 'own-1',
      },
    })

    const pool = await loadSlotCandidates(
      household,
      { id: entry.id, mealType: 'dinner', mealId: 'own-1' },
      'swap',
    )
    const suggestions = await suggestForSlot(
      household,
      {
        id: entry.id,
        mealType: 'dinner',
        mealId: 'own-1',
        meal: { timeMinutes: null, primaryProteinType: 'none' },
      },
      'swap',
      'en',
    )

    expect(pool.map((meal) => meal.id)).not.toContain('own-1')
    expect(pool.map((meal) => meal.id)).toContain('own-2')
    expect(suggestions.map((meal) => meal.id)).not.toContain('own-1')
  })
})
