import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { deleteMeal } from './delete-meal'
import { listMeals } from './list-meals'
import { restoreMeal } from './restore-meal'

// Runs against PGlite through the `unit-db` project, with no mocks: the
// recipe is deleted with `delete_meal` and brought back with `restore_meal`
// (HON-1337). The window is 30 days, taken from the issue.

const CALLER = { userId: 'user-1' }
const DAY_MS = 24 * 60 * 60 * 1000
const IMAGE = 'https://store.example/meals/meal-lasagne.png'
const NOT_FOUND =
  'No recipe of this household deleted in the last 30 days with this id. A recipe deleted longer ago cannot be restored. Nothing was changed.'

/**
 * Alder has its own lasagne with an image, and a soup it deleted 31 days ago.
 * Birch has a pie it deleted yesterday.
 */
async function world() {
  const row = await prisma.household.create({ data: { name: 'Alder', locale: 'en' } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)
  await prisma.meal.create({
    data: {
      id: 'meal-lasagne',
      name: 'Glimmer lasagne',
      suitableFor: ['dinner'],
      householdId: row.id,
      imageUrl: IMAGE,
      imageStatus: 'ready',
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-soup',
      name: 'Glimmer soup',
      suitableFor: ['dinner'],
      householdId: row.id,
      deletedAt: daysAgo(31),
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-pie',
      name: 'Birch pie',
      suitableFor: ['dinner'],
      householdId: birch.id,
      deletedAt: daysAgo(1),
    },
  })
  return mcpHousehold({ id: row.id, locale: 'en' })
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, mealId: string) {
  return restoreMeal.run(household, restoreMeal.inputSchema.parse({ mealId }), CALLER)
}

async function ownRecipeIds(household: Household) {
  const result = await listMeals.run(
    household,
    listMeals.inputSchema.parse({ source: 'own' }),
    CALLER,
  )
  return result.meals.map((m) => m.id)
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ToolInputError)
  return (error as ToolInputError).message
}

describe('restore_meal', () => {
  it('brings back a recipe delete_meal deleted, with its image, and a second call answers unchanged', async () => {
    const alder = await world()
    await deleteMeal.run(alder, { mealId: 'meal-lasagne' }, CALLER)
    expect(await ownRecipeIds(alder)).toEqual([])

    const meal = { id: 'meal-lasagne', name: 'Glimmer lasagne' }
    expect(await call(alder, 'meal-lasagne')).toEqual({ outcome: 'restored', meal })

    expect(await ownRecipeIds(alder)).toEqual(['meal-lasagne'])
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-lasagne' } })
    expect(row).toMatchObject({ deletedAt: null, imageUrl: IMAGE, imageStatus: 'ready' })
    expect(await call(alder, 'meal-lasagne')).toEqual({ outcome: 'unchanged', meal })
  })

  it('refuses a recipe deleted 31 days ago, and it stays deleted', async () => {
    const alder = await world()

    expect(await refusal(call(alder, 'meal-soup'))).toBe(NOT_FOUND)
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-soup' } })
    expect(row.deletedAt).toBeInstanceOf(Date)
  })

  it("refuses another household's or an unknown recipe, and restores nothing", async () => {
    const alder = await world()

    expect(await refusal(call(alder, 'meal-pie'))).toBe(NOT_FOUND)
    expect(await refusal(call(alder, 'meal-nobody'))).toBe(NOT_FOUND)
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-pie' } })
    expect(row.deletedAt).toBeInstanceOf(Date)
  })

  it('answers a read-only token with the reconnect message, and the recipe stays deleted', async () => {
    const alder = await world()
    await deleteMeal.run(alder, { mealId: 'meal-lasagne' }, CALLER)

    const result = await runTool(
      restoreMeal,
      { userId: 'user-1', household: alder, scopes: READ_SCOPES },
      { mealId: 'meal-lasagne' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-lasagne' } })
    expect(row.deletedAt).toBeInstanceOf(Date)
  })
})
