import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { listMeals } from './list-meals'
import { setFavourite } from './set-favourite'

// Runs against PGlite through the `unit-db` project, with no mocks: the meals
// are written with Prisma and the favourites are read back through list_meals
// and the `favoriteMeal` rows (HON-1333).
//
// The migrations seed a shared catalogue, so the meal names here are invented
// words that match no seeded meal.

const CALLER = { userId: 'user-1' }
const NOT_FOUND = 'No meal with this id. Use list_meals to find it. Nothing was changed.'

/** Alder (English) and Birch (Estonian), a shared meal, and Birch's own recipe. */
async function world() {
  const household = async (name: string, locale: string) => {
    const row = await prisma.household.create({
      data: { name, locale, timezone: 'Europe/Tallinn' },
    })
    return mcpHousehold({ id: row.id, locale, timezone: 'Europe/Tallinn' })
  }
  const alder = await household('Alder', 'en')
  const birch = await household('Birch', 'et')
  const shared = await prisma.meal.create({
    data: {
      name: 'Zentrafloss bake',
      suitableFor: ['dinner'],
      translations: { create: { locale: 'et', name: 'Zentraflossi vorm' } },
    },
  })
  const birchOwn = await prisma.meal.create({
    data: { name: 'Plinkvortex soup', suitableFor: ['dinner'], householdId: birch.id },
  })
  return { alder, birch, sharedId: shared.id, birchOwnId: birchOwn.id }
}

function call(household: ReturnType<typeof mcpHousehold>, mealId: string, favourite: boolean) {
  return setFavourite.run(household, setFavourite.inputSchema.parse({ mealId, favourite }), CALLER)
}

async function listedFavourites(household: ReturnType<typeof mcpHousehold>) {
  const list = await listMeals.run(
    household,
    listMeals.inputSchema.parse({ source: 'favourites' }),
    CALLER,
  )
  return list.meals.map((meal) => ({ name: meal.name, isFavorite: meal.isFavorite }))
}

describe('set_favourite', () => {
  it('adds a shared meal, and list_meals with source favourites lists it', async () => {
    const { alder, sharedId } = await world()
    expect(await listedFavourites(alder)).toEqual([])

    const result = await call(alder, sharedId, true)

    expect(result).toEqual({
      outcome: 'added',
      meal: { id: sharedId, name: 'Zentrafloss bake' },
      isFavorite: true,
    })
    expect(await listedFavourites(alder)).toEqual([{ name: 'Zentrafloss bake', isFavorite: true }])
  })

  it('answers a second add with unchanged, and keeps one favourite', async () => {
    const { alder, sharedId } = await world()
    await call(alder, sharedId, true)

    const result = await call(alder, sharedId, true)

    expect(result).toEqual({
      outcome: 'unchanged',
      meal: { id: sharedId, name: 'Zentrafloss bake' },
      isFavorite: true,
    })
    expect(await prisma.favoriteMeal.count({ where: { householdId: alder.id } })).toBe(1)
  })

  it('removes a favourite, and answers a second remove with unchanged', async () => {
    const { alder, sharedId } = await world()
    await call(alder, sharedId, true)

    const removed = await call(alder, sharedId, false)
    const again = await call(alder, sharedId, false)

    const meal = { id: sharedId, name: 'Zentrafloss bake' }
    expect(removed).toEqual({ outcome: 'removed', meal, isFavorite: false })
    expect(again).toEqual({ outcome: 'unchanged', meal, isFavorite: false })
    expect(await listedFavourites(alder)).toEqual([])
  })

  it("names the meal in the household's locale", async () => {
    const { birch, sharedId, birchOwnId } = await world()

    expect((await call(birch, sharedId, true)).meal).toEqual({
      id: sharedId,
      name: 'Zentraflossi vorm',
    })
    expect((await call(birch, birchOwnId, true)).meal).toEqual({
      id: birchOwnId,
      name: 'Plinkvortex soup',
    })
  })

  it.each([true, false])(
    'refuses an unknown meal id with favourite %s, and writes no favourite',
    async (favourite) => {
      const { alder } = await world()

      const attempt = call(alder, 'meal-none', favourite)

      await expect(attempt).rejects.toThrow(ToolInputError)
      await expect(attempt).rejects.toThrow(NOT_FOUND)
      expect(await prisma.favoriteMeal.count()).toBe(0)
    },
  )

  it.each([true, false])(
    "refuses another household's own recipe with favourite %s, and leaves its favourite alone",
    async (favourite) => {
      const { alder, birch, birchOwnId } = await world()
      await call(birch, birchOwnId, true)

      const attempt = call(alder, birchOwnId, favourite)

      await expect(attempt).rejects.toThrow(ToolInputError)
      await expect(attempt).rejects.toThrow(NOT_FOUND)
      expect(await prisma.favoriteMeal.count({ where: { householdId: alder.id } })).toBe(0)
      expect(await prisma.favoriteMeal.count({ where: { householdId: birch.id } })).toBe(1)
    },
  )

  it('answers a read-only token with the reconnect message, and writes no favourite', async () => {
    const { alder, sharedId } = await world()

    const result = await runTool(
      setFavourite,
      { userId: 'user-1', household: alder, scopes: READ_SCOPES },
      { mealId: sharedId, favourite: true },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await prisma.favoriteMeal.count()).toBe(0)
  })
})
