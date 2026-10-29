import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listRecentlyDeletedHouseholdMeals } from '@/lib/deleted-household-meals'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { createMeal } from './create-meal'
import { deleteMeal } from './delete-meal'
import { getMeal } from './get-meal'
import { listMeals } from './list-meals'
import { updateMeal } from './update-meal'

// Runs against PGlite through the `unit-db` project, with no mocks: the
// recipes are written with Prisma, deleted through the tool, and read back
// with the other tools and the Recently deleted list (HON-1337).

// 22:30 UTC on Monday 26 October 2026 is already Tuesday 27 October in
// Tallinn (UTC+2), so 30 days later is 26 November there, not 25 November.
const NOW = new Date('2026-10-26T22:30:00Z')
const RESTORABLE_UNTIL = '2026-11-26'
const CALLER = { userId: 'user-1' }
const NOT_FOUND =
  'No recipe of this household with this id. Use list_meals with source own to find it. Nothing was changed.'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Alder, in Tallinn, has its own lasagne, planned for Saturday, and a soup it
 * deleted on 1 October. Birch has its own pie. The library has a shared stew.
 */
async function world() {
  const row = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'en',
      timezone: 'Europe/Tallinn',
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  const meal = (id: string, name: string, householdId: string | null, deletedAt?: Date) =>
    prisma.meal.create({ data: { id, name, suitableFor: ['dinner'], householdId, deletedAt } })
  await meal('meal-lasagne', 'Glimmer lasagne', row.id)
  await meal('meal-soup', 'Glimmer soup', row.id, new Date('2026-10-01T12:00:00Z'))
  await meal('meal-pie', 'Birch pie', birch.id)
  await meal('meal-stew', 'Shared stew', null)
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-lasagne',
      planId: 'plan-alder',
      date: parseLocalDate('2026-10-31'),
      mealType: 'dinner',
      mealId: 'meal-lasagne',
    },
  })
  return mcpHousehold({ id: row.id, locale: 'en', timezone: 'Europe/Tallinn' })
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, mealId: string) {
  return deleteMeal.run(household, deleteMeal.inputSchema.parse({ mealId }), CALLER)
}

async function ownRecipeIds(household: Household) {
  const result = await listMeals.run(
    household,
    listMeals.inputSchema.parse({ source: 'own' }),
    CALLER,
  )
  return result.meals.map((m) => m.id)
}

async function deletedAtOf(id: string) {
  return (await prisma.meal.findUniqueOrThrow({ where: { id } })).deletedAt
}

describe('delete_meal', () => {
  it('deletes a household recipe, lists it as recently deleted, and says until when it can be restored', async () => {
    const alder = await world()
    expect(await ownRecipeIds(alder)).toEqual(['meal-lasagne'])

    const result = await call(alder, 'meal-lasagne')

    expect(result).toEqual({
      outcome: 'deleted',
      meal: { id: 'meal-lasagne', name: 'Glimmer lasagne' },
      restorableUntil: RESTORABLE_UNTIL,
    })
    expect(await ownRecipeIds(alder)).toEqual([])
    expect(await listRecentlyDeletedHouseholdMeals(alder.id)).toEqual([
      { id: 'meal-lasagne', name: 'Glimmer lasagne', deletedAt: NOW },
      { id: 'meal-soup', name: 'Glimmer soup', deletedAt: new Date('2026-10-01T12:00:00Z') },
    ])
  })

  it('leaves the planned meal on the plan, and get_meal still reads the recipe', async () => {
    const alder = await world()

    await call(alder, 'meal-lasagne')

    const entry = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'entry-lasagne' } })
    expect(entry.mealId).toBe('meal-lasagne')
    const read = await getMeal.run(
      alder,
      getMeal.inputSchema.parse({ mealId: 'meal-lasagne' }),
      CALLER,
    )
    expect(read.meal).toEqual(
      expect.objectContaining({ id: 'meal-lasagne', name: 'Glimmer lasagne' }),
    )
  })

  it("refuses a shared, another household's, an unknown or a deleted recipe, and deletes nothing", async () => {
    const alder = await world()

    for (const id of ['meal-stew', 'meal-pie', 'meal-nobody', 'meal-soup']) {
      const error = await call(alder, id).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ToolInputError)
      expect((error as ToolInputError).message).toBe(NOT_FOUND)
    }
    expect(await deletedAtOf('meal-stew')).toBeNull()
    expect(await deletedAtOf('meal-pie')).toBeNull()
    expect(await deletedAtOf('meal-soup')).toEqual(new Date('2026-10-01T12:00:00Z'))
  })

  it('answers a read-only token with the reconnect message, and the recipe stays', async () => {
    const alder = await world()

    const result = await runTool(
      deleteMeal,
      { userId: 'user-1', household: alder, scopes: READ_SCOPES },
      { mealId: 'meal-lasagne' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await deletedAtOf('meal-lasagne')).toBeNull()
  })

  it('is the tool create_meal and update_meal point to for a delete', () => {
    for (const tool of [createMeal, updateMeal]) {
      expect(tool.description).toContain('To delete a recipe, use delete_meal.')
      expect(tool.description).not.toContain('No tool deletes a recipe.')
    }
  })
})
