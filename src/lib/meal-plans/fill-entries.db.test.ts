import { describe, expect, it } from 'vitest'

import { entry, readEntry, world } from '@/lib/meal-plans/entries.fixtures'
import { writeFilledSlots } from '@/lib/meal-plans/fill-entries'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// `fill-plan.test.ts` covers which entries `fillEmptySlots` passes in.

describe('writeFilledSlots', () => {
  const date = new Date('2026-10-15T00:00:00Z')

  const slotEntries = (mealType: 'lunch' | 'dinner') =>
    prisma.mealPlanEntry.findMany({ where: { planId: 'plan-alder', date, mealType } })

  it('puts the meal on a note-only entry and keeps its id and note', async () => {
    await world()
    const noteSlip = await entry('entry-note', {
      date,
      mealType: 'lunch',
      mealId: null,
      note: 'Grandma visits',
      noteX: 0.25,
      noteY: 0.75,
    })

    await writeFilledSlots(
      'plan-alder',
      [{ date, mealType: 'lunch', mealId: 'meal-salad' }],
      [noteSlip],
    )

    expect(await slotEntries('lunch')).toEqual([
      expect.objectContaining({
        id: 'entry-note',
        mealId: 'meal-salad',
        status: 'planned',
        note: 'Grandma visits',
        noteX: 0.25,
        noteY: 0.75,
      }),
    ])
  })

  it('creates a new entry when the note slip is gone by the time it writes', async () => {
    await world()
    const noteSlip = await entry('entry-note', { date, mealId: null, note: 'Grandma visits' })
    await prisma.mealPlanEntry.delete({ where: { id: 'entry-note' } })

    await writeFilledSlots(
      'plan-alder',
      [{ date, mealType: 'dinner', mealId: 'meal-stew' }],
      [noteSlip],
    )

    expect(await slotEntries('dinner')).toEqual([
      expect.objectContaining({ mealId: 'meal-stew', status: 'planned', note: null }),
    ])
  })

  it('replaces an entry with no meal and no note with a new one', async () => {
    await world()
    const placeholder = await entry('entry-placeholder', { date, mealId: null })

    await writeFilledSlots(
      'plan-alder',
      [{ date, mealType: 'dinner', mealId: 'meal-stew' }],
      [placeholder],
    )

    expect(await slotEntries('dinner')).toEqual([
      expect.objectContaining({ mealId: 'meal-stew', status: 'planned', note: null }),
    ])
    expect(await prisma.mealPlanEntry.count({ where: { id: 'entry-placeholder' } })).toBe(0)
  })

  it('keeps a meal the household picked on a placeholder while the model ran', async () => {
    await world()
    const placeholder = await entry('entry-placeholder', { date, mealId: null })
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-placeholder' },
      data: { mealId: 'meal-salad' },
    })

    await expect(
      writeFilledSlots(
        'plan-alder',
        [{ date, mealType: 'dinner', mealId: 'meal-stew' }],
        [placeholder],
      ),
    ).rejects.toThrow()

    expect(await readEntry('entry-placeholder')).toEqual(
      expect.objectContaining({ mealId: 'meal-salad' }),
    )
  })

  it('leaves entries it was not given untouched', async () => {
    await world()
    await entry('entry-other', { mealId: null, note: 'Eat out', mealType: 'lunch' })

    await writeFilledSlots('plan-alder', [{ date, mealType: 'dinner', mealId: 'meal-stew' }], [])

    expect(await readEntry('entry-other')).toEqual(
      expect.objectContaining({ mealId: null, note: 'Eat out' }),
    )
    expect(await slotEntries('dinner')).toEqual([
      expect.objectContaining({ mealId: 'meal-stew', status: 'planned' }),
    ])
  })
})
