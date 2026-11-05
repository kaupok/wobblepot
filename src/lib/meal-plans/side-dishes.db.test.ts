import { describe, expect, it } from 'vitest'

import { Prisma } from '@/generated/prisma/client'
import { getCandidates } from '@/lib/meal-planning/candidates'
import { isMealAllowedForSlot } from '@/lib/meal-planning/meal-allowed-for-slot'
import { createEntry, EntryCreateError } from '@/lib/meal-plans/create-entry'
import { entry, world } from '@/lib/meal-plans/entries.fixtures'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks,
// so the migration's partial index and cascade are the ones under test.
// HON-1608: a slot holds one main and any number of sides.

describe('side dishes in a slot', () => {
  it('refuses a second main in a slot with P2002', async () => {
    await world()

    const error = await entry('entry-second-main', { mealId: 'meal-salad' }).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002')
  })

  it('maps a second main to slotTaken in createEntry', async () => {
    const { alder } = await world()

    const error = await createEntry(alder.id, 'plan-alder', {
      date: new Date('2026-10-14T00:00:00Z'),
      mealType: 'dinner',
      mealId: 'meal-salad',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(EntryCreateError)
    expect((error as EntryCreateError).reason).toBe('slotTaken')
  })

  it('saves a main and two sides in one slot', async () => {
    await world()

    await entry('entry-side-1', { mealId: 'meal-salad', mainEntryId: 'entry-alder' })
    await entry('entry-side-2', { mealId: 'meal-empty', mainEntryId: 'entry-alder' })

    const slot = await prisma.mealPlanEntry.findMany({
      where: { planId: 'plan-alder', mealType: 'dinner' },
      select: { id: true, mainEntryId: true },
      orderBy: { id: 'asc' },
    })
    expect(slot).toEqual([
      { id: 'entry-alder', mainEntryId: null },
      { id: 'entry-side-1', mainEntryId: 'entry-alder' },
      { id: 'entry-side-2', mainEntryId: 'entry-alder' },
    ])
  })

  it('deletes the sides with their main', async () => {
    await world()
    await entry('entry-side-1', { mealId: 'meal-salad', mainEntryId: 'entry-alder' })
    await entry('entry-side-2', { mealId: 'meal-empty', mainEntryId: 'entry-alder' })

    await prisma.mealPlanEntry.delete({ where: { id: 'entry-alder' } })

    expect(await prisma.mealPlanEntry.count({ where: { planId: 'plan-alder' } })).toBe(0)
  })
})

describe('a side recipe in the suggestion pools', () => {
  it('is left out of the suggestions but still fits the slot as a pick', async () => {
    const { alder } = await world()
    await prisma.meal.create({
      data: {
        id: 'meal-cucumber-salad',
        name: 'Cucumber salad',
        suitableFor: ['dinner'],
        course: 'side',
      },
    })
    await prisma.meal.create({
      data: { id: 'meal-goulash', name: 'Goulash', suitableFor: ['dinner'] },
    })
    const filters = {
      mealType: 'dinner' as const,
      allergensToAvoid: [],
      excludedIngredientIds: [],
      householdId: alder.id,
    }

    const suggested = await getCandidates({ ...filters, course: 'main' })

    expect(suggested.map((meal) => meal.id)).toEqual(['meal-goulash'])
    expect(await isMealAllowedForSlot({ id: alder.id }, 'meal-cucumber-salad', 'dinner')).toBe(
      'allowed',
    )
  })
})
