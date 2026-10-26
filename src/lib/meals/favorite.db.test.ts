import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  addFavorite,
  FavoriteError,
  findVisibleMealName,
  removeFavorite,
  type FavoriteRefusal,
} from '@/lib/meals/favorite'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

/** Alder and Birch, a library meal, one custom meal each, and a deleted meal. */
async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  await prisma.meal.create({ data: { id: 'meal-library', name: 'Porridge' } })
  await prisma.meal.create({ data: { id: 'meal-alder', name: 'Stew', householdId: alder.id } })
  await prisma.meal.create({ data: { id: 'meal-birch', name: 'Soup', householdId: birch.id } })
  await prisma.meal.create({ data: { id: 'meal-deleted', name: 'Gone', deletedAt: new Date() } })
  return { alder: alder.id, birch: birch.id }
}

const favourites = (householdId: string) =>
  prisma.favoriteMeal
    .findMany({ where: { householdId }, orderBy: { mealId: 'asc' } })
    .then((rows) => rows.map((row) => row.mealId))

async function refusalOf(promise: Promise<unknown>): Promise<FavoriteRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof FavoriteError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

describe('addFavorite', () => {
  it('favourites a library meal and returns the new row id', async () => {
    const { alder } = await world()

    const { id } = await addFavorite(alder, 'meal-library')

    const row = await prisma.favoriteMeal.findUniqueOrThrow({ where: { id } })
    expect(row).toMatchObject({ householdId: alder, mealId: 'meal-library' })
  })

  it("favourites the household's own meal", async () => {
    const { alder } = await world()

    await addFavorite(alder, 'meal-alder')

    expect(await favourites(alder)).toEqual(['meal-alder'])
  })

  it('refuses a meal the household already favourites, and keeps one row', async () => {
    const { alder } = await world()
    await addFavorite(alder, 'meal-library')

    expect(await refusalOf(addFavorite(alder, 'meal-library'))).toBe('alreadyFavorite')
    expect(await favourites(alder)).toEqual(['meal-library'])
  })

  it('answers one of two concurrent requests with alreadyFavorite', async () => {
    const { alder } = await world()

    const results = await Promise.allSettled([
      addFavorite(alder, 'meal-library'),
      addFavorite(alder, 'meal-library'),
    ])

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find((r) => r.status === 'rejected')!
    expect((rejected.reason as FavoriteError).reason).toBe('alreadyFavorite')
    expect(await favourites(alder)).toEqual(['meal-library'])
  })

  it("refuses another household's meal", async () => {
    const { alder } = await world()

    expect(await refusalOf(addFavorite(alder, 'meal-birch'))).toBe('mealNotFound')
    expect(await favourites(alder)).toEqual([])
  })

  it('refuses a deleted meal and a meal that does not exist', async () => {
    const { alder } = await world()

    expect(await refusalOf(addFavorite(alder, 'meal-deleted'))).toBe('mealNotFound')
    expect(await refusalOf(addFavorite(alder, 'meal-none'))).toBe('mealNotFound')
  })

  it("leaves another household's favourite of the same meal alone", async () => {
    const { alder, birch } = await world()
    await addFavorite(birch, 'meal-library')

    await addFavorite(alder, 'meal-library')

    expect(await favourites(alder)).toEqual(['meal-library'])
    expect(await favourites(birch)).toEqual(['meal-library'])
  })
})

describe('removeFavorite', () => {
  it('removes the favourite', async () => {
    const { alder } = await world()
    await addFavorite(alder, 'meal-library')
    await addFavorite(alder, 'meal-alder')

    await removeFavorite(alder, 'meal-library')

    expect(await favourites(alder)).toEqual(['meal-alder'])
  })

  it('refuses a meal the household does not favourite', async () => {
    const { alder } = await world()

    expect(await refusalOf(removeFavorite(alder, 'meal-library'))).toBe('notFavorite')
  })

  it("never removes another household's favourite", async () => {
    const { alder, birch } = await world()
    await addFavorite(birch, 'meal-library')

    expect(await refusalOf(removeFavorite(alder, 'meal-library'))).toBe('notFavorite')
    expect(await favourites(birch)).toEqual(['meal-library'])
  })
})

describe('findVisibleMealName', () => {
  it("returns a library meal and the household's own meal", async () => {
    const { alder } = await world()

    expect(await findVisibleMealName(alder, 'meal-library', 'en')).toEqual({
      id: 'meal-library',
      name: 'Porridge',
    })
    expect(await findVisibleMealName(alder, 'meal-alder', 'en')).toEqual({
      id: 'meal-alder',
      name: 'Stew',
    })
  })

  it("returns null for another household's meal, a deleted meal and an unknown id", async () => {
    const { alder } = await world()

    expect(await findVisibleMealName(alder, 'meal-birch', 'en')).toBeNull()
    expect(await findVisibleMealName(alder, 'meal-deleted', 'en')).toBeNull()
    expect(await findVisibleMealName(alder, 'meal-none', 'en')).toBeNull()
  })

  it('names the meal in the locale, and in English without a translation', async () => {
    const { alder } = await world()
    await prisma.mealTranslation.create({
      data: { mealId: 'meal-library', locale: 'et', name: 'Puder' },
    })

    expect(await findVisibleMealName(alder, 'meal-library', 'et')).toEqual({
      id: 'meal-library',
      name: 'Puder',
    })
    expect(await findVisibleMealName(alder, 'meal-alder', 'et')).toEqual({
      id: 'meal-alder',
      name: 'Stew',
    })
  })
})
