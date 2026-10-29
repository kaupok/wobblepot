import { describe, expect, it } from 'vitest'

import {
  createEntry,
  EntryCreateError,
  type EntryCreateRefusal,
} from '@/lib/meal-plans/create-entry'
import { entry, readEntry, world } from '@/lib/meal-plans/entries.fixtures'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// The route test covers only how the route maps these answers.

describe('createEntry', () => {
  const date = new Date('2026-10-15T00:00:00Z')

  async function createRefusal(promise: Promise<unknown>): Promise<EntryCreateRefusal> {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    )
    if (!(error instanceof EntryCreateError)) throw new Error(`Expected a refusal, got ${error}`)
    return error.reason
  }

  it('creates a planned entry in an empty slot and returns it', async () => {
    const { alder } = await world()

    const created = await createEntry(alder.id, 'plan-alder', {
      date,
      mealType: 'lunch',
      mealId: 'meal-salad',
    })

    expect(created).toEqual({
      id: expect.any(String),
      date: '2026-10-15',
      mealType: 'lunch',
      status: 'planned',
      mealId: 'meal-salad',
      note: null,
    })
    expect(await readEntry(created.id)).toMatchObject({
      planId: 'plan-alder',
      date,
      mealType: 'lunch',
      mealId: 'meal-salad',
      status: 'planned',
      note: null,
      noteX: null,
      noteY: null,
      servingOverride: null,
      rating: null,
      pantryDeductedAt: null,
    })
  })

  it('creates an empty slot with no meal', async () => {
    const { alder } = await world()

    const created = await createEntry(alder.id, 'plan-alder', { date, mealType: 'dinner' })

    expect((await readEntry(created.id)).mealId).toBeNull()
  })

  // Undo after Clear posts the cleared entry back (HON-1123).
  it("writes a restored entry's fields back, pantry charge included", async () => {
    const { alder } = await world()

    const created = await createEntry(alder.id, 'plan-alder', {
      date,
      mealType: 'dinner',
      mealId: 'meal-stew',
      note: 'Leftovers for lunch',
      noteX: 0.25,
      noteY: 0.75,
      status: 'skipped',
      servingOverride: 6,
      rating: 'down',
      pantryDeducted: true,
    })

    expect(await readEntry(created.id)).toMatchObject({
      mealId: 'meal-stew',
      note: 'Leftovers for lunch',
      noteX: 0.25,
      noteY: 0.75,
      status: 'skipped',
      servingOverride: 6,
      rating: 'down',
      pantryDeductedAt: expect.any(Date),
    })
  })

  it("accepts the household's own meal", async () => {
    const { birch } = await world()

    const created = await createEntry(birch.id, 'plan-birch', {
      date,
      mealType: 'dinner',
      mealId: 'meal-birch',
    })

    expect(created.mealId).toBe('meal-birch')
  })

  it.each(['meal-birch', 'meal-deleted', 'meal-missing'])(
    'refuses %s as mealNotFound and writes nothing',
    async (mealId) => {
      const { alder } = await world()

      expect(
        await createRefusal(
          createEntry(alder.id, 'plan-alder', { date, mealType: 'dinner', mealId }),
        ),
      ).toBe('mealNotFound')
      expect(await prisma.mealPlanEntry.count()).toBe(2)
    },
  )

  // A restore after Clear leaves a slot that was refilled meanwhile alone.
  it('refuses a taken slot as slotTaken and leaves the entry there', async () => {
    const { alder } = await world()

    expect(
      await createRefusal(
        createEntry(alder.id, 'plan-alder', {
          date: new Date('2026-10-14T00:00:00Z'),
          mealType: 'dinner',
          mealId: 'meal-salad',
        }),
      ),
    ).toBe('slotTaken')
    expect((await readEntry()).mealId).toBe('meal-stew')
  })

  // A picker placeholder whose discard never ran (HON-1251).
  it('replaces an entry with no meal and no note', async () => {
    const { alder } = await world()
    await entry('entry-leaked', { date, mealId: null })

    const created = await createEntry(alder.id, 'plan-alder', {
      date,
      mealType: 'dinner',
      mealId: 'meal-salad',
    })

    expect(created.id).not.toBe('entry-leaked')
    expect(await prisma.mealPlanEntry.findUnique({ where: { id: 'entry-leaked' } })).toBeNull()
    expect((await readEntry(created.id)).mealId).toBe('meal-salad')
  })

  // Both read the slot as free; the unique index refuses the second write.
  it('refuses the loser of two creates on one slot as slotTaken', async () => {
    const { alder } = await world()
    const create = (mealId: string) =>
      createEntry(alder.id, 'plan-alder', { date, mealType: 'dinner', mealId })

    const results = await Promise.allSettled([create('meal-stew'), create('meal-salad')])

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const loser = results.find((r) => r.status === 'rejected')
    expect(await createRefusal(Promise.reject(loser?.reason))).toBe('slotTaken')
  })

  it('refuses a slot whose only entry is a note as slotTaken and keeps the note', async () => {
    const { alder } = await world()
    await entry('entry-note', { date, mealId: null, note: 'Eating out' })

    expect(
      await createRefusal(createEntry(alder.id, 'plan-alder', { date, mealType: 'dinner' })),
    ).toBe('slotTaken')
    expect((await readEntry('entry-note')).note).toBe('Eating out')
  })

  it("refuses another household's plan as planNotFound and writes nothing", async () => {
    const { alder } = await world()

    expect(
      await createRefusal(createEntry(alder.id, 'plan-birch', { date, mealType: 'dinner' })),
    ).toBe('planNotFound')
    expect(await prisma.mealPlanEntry.count({ where: { planId: 'plan-birch' } })).toBe(1)
  })
})
