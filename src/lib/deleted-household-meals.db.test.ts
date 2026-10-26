import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  deleteHouseholdMeal,
  HouseholdMealError,
  type HouseholdMealRefusal,
} from '@/lib/household-meals'
import { createEntry, EntryCreateError } from '@/lib/meal-plans/create-entry'
import {
  listRecentlyDeletedHouseholdMeals,
  restoreHouseholdMeal,
} from '@/lib/deleted-household-meals'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// The restore window is 30 days (HON-1336), taken from the issue, not the
// constant, so a change to the constant turns these red.

const NOW = new Date('2026-10-26T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)
const IMAGE = 'https://store.example/meals/meal-recent.png'

/**
 * Alder has a meal plan, a live curry, a recipe deleted 1 day ago with an image, one
 * deleted 29 days ago, and one deleted 31 days ago. Birch has one deleted
 * 2 days ago. The library has one meal.
 */
async function world() {
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })

  const meal = (id: string, householdId: string | null, deletedAt: Date | null) =>
    prisma.meal.create({
      data: { id, name: id.replace('meal-', ''), suitableFor: ['dinner'], householdId, deletedAt },
    })

  await meal('meal-live', alder.id, null)
  await prisma.meal.create({
    data: {
      id: 'meal-recent',
      name: 'recent',
      suitableFor: ['dinner'],
      householdId: alder.id,
      deletedAt: daysAgo(1),
      imageUrl: IMAGE,
      imageStatus: 'ready',
    },
  })
  await meal('meal-29', alder.id, daysAgo(29))
  await meal('meal-31', alder.id, daysAgo(31))
  await meal('meal-birch', birch.id, daysAgo(2))
  await meal('meal-library', null, null)

  return { alder: alder.id, birch: birch.id }
}

async function reasonOf(promise: Promise<unknown>): Promise<HouseholdMealRefusal> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  if (!(error instanceof HouseholdMealError)) throw new Error(`expected a refusal, got ${error}`)
  return error.reason
}

async function deletedAtOf(id: string) {
  return (await prisma.meal.findUniqueOrThrow({ where: { id } })).deletedAt
}

describe('listRecentlyDeletedHouseholdMeals', () => {
  it("lists the household's recipes deleted in the last 30 days, newest first", async () => {
    const { alder } = await world()

    expect(await listRecentlyDeletedHouseholdMeals(alder, NOW)).toEqual([
      { id: 'meal-recent', name: 'recent', deletedAt: daysAgo(1) },
      { id: 'meal-29', name: '29', deletedAt: daysAgo(29) },
    ])
  })

  it('lists nothing for a household with no recently deleted recipe', async () => {
    const empty = await prisma.household.create({ data: { name: 'Empty' } })

    expect(await listRecentlyDeletedHouseholdMeals(empty.id, NOW)).toEqual([])
  })
})

describe('restoreHouseholdMeal', () => {
  it('brings back a recipe deleted within 30 days with its image', async () => {
    const { alder } = await world()

    await restoreHouseholdMeal(alder, 'meal-recent', NOW)

    const row = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-recent' } })
    expect(row).toMatchObject({ deletedAt: null, imageUrl: IMAGE, imageStatus: 'ready' })
  })

  it('brings back a recipe deleted 29 days ago', async () => {
    const { alder } = await world()

    await restoreHouseholdMeal(alder, 'meal-29', NOW)

    expect(await deletedAtOf('meal-29')).toBeNull()
  })

  it('answers mealNotFound for a recipe deleted 31 days ago, and writes nothing', async () => {
    const { alder } = await world()

    expect(await reasonOf(restoreHouseholdMeal(alder, 'meal-31', NOW))).toBe('mealNotFound')
    expect(await deletedAtOf('meal-31')).toEqual(daysAgo(31))
  })

  it('answers mealNotDeleted for a live recipe', async () => {
    const { alder } = await world()

    expect(await reasonOf(restoreHouseholdMeal(alder, 'meal-live', NOW))).toBe('mealNotDeleted')
  })

  it("answers mealNotFound for another household's, a library or an unknown recipe, and writes nothing", async () => {
    const { alder } = await world()

    for (const id of ['meal-birch', 'meal-library', 'meal-nobody']) {
      expect(await reasonOf(restoreHouseholdMeal(alder, id, NOW))).toBe('mealNotFound')
    }
    expect(await deletedAtOf('meal-birch')).toEqual(daysAgo(2))
  })

  it('restores a recipe whose name a live recipe now has', async () => {
    const { alder } = await world()
    await prisma.meal.update({ where: { id: 'meal-live' }, data: { name: 'recent' } })

    await restoreHouseholdMeal(alder, 'meal-recent', NOW)

    expect(await deletedAtOf('meal-recent')).toBeNull()
  })
  it('lets the planner plan a recipe again once it is restored', async () => {
    const { alder } = await world()
    const slot = { date: new Date('2026-10-27T00:00:00Z'), mealType: 'dinner' as const }
    await deleteHouseholdMeal(alder, 'meal-live')

    const refused = await createEntry(alder, 'plan-alder', { ...slot, mealId: 'meal-live' }).catch(
      (error: unknown) => error,
    )
    expect(refused).toBeInstanceOf(EntryCreateError)
    expect((refused as EntryCreateError).reason).toBe('mealNotFound')

    await restoreHouseholdMeal(alder, 'meal-live')

    const planned = await createEntry(alder, 'plan-alder', { ...slot, mealId: 'meal-live' })
    expect(planned).toMatchObject({ mealId: 'meal-live', status: 'planned' })
  })
})
