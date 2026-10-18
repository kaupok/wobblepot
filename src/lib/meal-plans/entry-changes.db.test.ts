import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  addEntryChange,
  EntryChangeError,
  removeEntryChange,
  type EntryChangeRefusal,
} from '@/lib/meal-plans/entry-changes'
import type { MealPlanEntryStatus } from '@/generated/prisma/enums'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

const TIPS = '{"steps":["Boil"],"pitfalls":[],"servings":2}'

/**
 * Alder plans a cream pasta for dinner on two days, both with cached tips.
 * The pasta is 100 g pasta and 50 g cream per serving. Yoghurt and chili are
 * global; Birch has its own ingredient and its own entry.
 */
async function world() {
  const ingredient = (id: string, householdId: string | null = null) =>
    prisma.ingredient.create({
      data: {
        id,
        name: id,
        householdId,
        category: 'dairy',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  for (const id of ['pasta', 'cream', 'yoghurt', 'chili']) await ingredient(id)
  await ingredient('birch-secret', birch.id)
  await prisma.meal.create({
    data: {
      id: 'meal-pasta',
      name: 'Cream pasta',
      components: {
        create: [
          { ingredientId: 'pasta', quantityPerServing: 100 },
          { ingredientId: 'cream', quantityPerServing: 50 },
        ],
      },
      preparationSteps: {
        create: { locale: 'en', servings: 4, steps: '{"steps":["Shared"]}', inputHash: 'h' },
      },
    },
  })
  await entry('entry-mon', 'plan-alder', '2026-10-19')
  await entry('entry-tue', 'plan-alder', '2026-10-20')
  await entry('entry-birch', 'plan-birch', '2026-10-19')
  return { alder, birch }
}

function entry(id: string, planId: string, date: string, status: MealPlanEntryStatus = 'planned') {
  return prisma.mealPlanEntry.create({
    data: {
      id,
      planId,
      date: new Date(`${date}T00:00:00Z`),
      mealType: 'dinner',
      mealId: 'meal-pasta',
      status,
      preparationTips: TIPS,
    },
  })
}

const replace = {
  originalIngredientId: 'cream',
  replacementIngredientId: 'yoghurt',
  quantityPerServing: 60,
}
const leaveOut = {
  originalIngredientId: 'cream',
  replacementIngredientId: null,
  quantityPerServing: null,
}
const add = (id: string) => ({
  originalIngredientId: null,
  replacementIngredientId: id,
  quantityPerServing: 2,
})

async function refusal(promise: Promise<unknown>): Promise<EntryChangeRefusal> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(EntryChangeError)
  return (error as EntryChangeError).reason
}

const tipsOf = async (id: string) =>
  (await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id } })).preparationTips

describe('addEntryChange', () => {
  it('replaces an ingredient on one entry and returns the merged components', async () => {
    const { alder } = await world()

    const { change, components } = await addEntryChange(
      alder.id,
      'plan-alder',
      'entry-mon',
      replace,
    )

    expect(change).toMatchObject({ entryId: 'entry-mon', ...replace })
    expect(components.map((c) => [c.ingredientId, c.quantityPerServing])).toEqual([
      ['pasta', 100],
      ['yoghurt', 60],
    ])
  })

  it("nulls that entry's tips and leaves the other entry, the meal and its shared steps alone", async () => {
    const { alder } = await world()

    await addEntryChange(alder.id, 'plan-alder', 'entry-mon', replace)

    expect(await tipsOf('entry-mon')).toBeNull()
    expect(await tipsOf('entry-tue')).toBe(TIPS)
    expect(await prisma.mealPlanEntryComponent.count({ where: { entryId: 'entry-tue' } })).toBe(0)
    const meal = await prisma.meal.findUniqueOrThrow({
      where: { id: 'meal-pasta' },
      include: { components: true, preparationSteps: true },
    })
    expect(meal.components.map((c) => c.ingredientId).sort()).toEqual(['cream', 'pasta'])
    expect(meal.preparationSteps.map((s) => s.steps)).toEqual(['{"steps":["Shared"]}'])
  })

  it('leaves an ingredient out', async () => {
    const { alder } = await world()

    const { components } = await addEntryChange(alder.id, 'plan-alder', 'entry-mon', leaveOut)

    expect(components.map((c) => c.ingredientId)).toEqual(['pasta'])
  })

  it('adds an ingredient after the recipe ones', async () => {
    const { alder } = await world()

    const { components } = await addEntryChange(alder.id, 'plan-alder', 'entry-mon', add('chili'))

    expect(components.map((c) => [c.ingredientId, c.quantityPerServing])).toEqual([
      ['pasta', 100],
      ['cream', 50],
      ['chili', 2],
    ])
  })

  it.each<MealPlanEntryStatus>(['completed', 'skipped'])(
    'refuses a %s entry as notPlanned and keeps its tips',
    async (status) => {
      const { alder } = await world()
      await prisma.mealPlanEntry.update({ where: { id: 'entry-mon' }, data: { status } })

      expect(await refusal(addEntryChange(alder.id, 'plan-alder', 'entry-mon', replace))).toBe(
        'notPlanned',
      )
      expect(await tipsOf('entry-mon')).toBe(TIPS)
      expect(await prisma.mealPlanEntryComponent.count()).toBe(0)
    },
  )

  it("refuses another household's entry as entryNotFound", async () => {
    const { alder, birch } = await world()

    expect(await refusal(addEntryChange(alder.id, 'plan-birch', 'entry-birch', replace))).toBe(
      'entryNotFound',
    )
    expect(await refusal(addEntryChange(birch.id, 'plan-alder', 'entry-mon', replace))).toBe(
      'entryNotFound',
    )
  })

  it("refuses another household's ingredient as ingredientNotFound", async () => {
    const { alder } = await world()

    expect(
      await refusal(addEntryChange(alder.id, 'plan-alder', 'entry-mon', add('birch-secret'))),
    ).toBe('ingredientNotFound')
    expect(
      await refusal(addEntryChange(alder.id, 'plan-alder', 'entry-mon', add('no-such-thing'))),
    ).toBe('ingredientNotFound')
  })

  it('refuses an original that is not in the meal', async () => {
    const { alder } = await world()

    expect(
      await refusal(
        addEntryChange(alder.id, 'plan-alder', 'entry-mon', {
          ...leaveOut,
          originalIngredientId: 'chili',
        }),
      ),
    ).toBe('originalNotInMeal')
  })

  it('refuses a second change of the same original', async () => {
    const { alder } = await world()
    await addEntryChange(alder.id, 'plan-alder', 'entry-mon', leaveOut)

    expect(await refusal(addEntryChange(alder.id, 'plan-alder', 'entry-mon', replace))).toBe(
      'alreadyChanged',
    )
  })

  it('refuses an ingredient that is in the meal already, by recipe, add or replacement', async () => {
    const { alder } = await world()

    expect(await refusal(addEntryChange(alder.id, 'plan-alder', 'entry-mon', add('pasta')))).toBe(
      'alreadyInMeal',
    )
    await addEntryChange(alder.id, 'plan-alder', 'entry-mon', add('chili'))
    expect(await refusal(addEntryChange(alder.id, 'plan-alder', 'entry-mon', add('chili')))).toBe(
      'alreadyInMeal',
    )
    expect(
      await refusal(
        addEntryChange(alder.id, 'plan-alder', 'entry-mon', {
          ...replace,
          replacementIngredientId: 'chili',
        }),
      ),
    ).toBe('alreadyInMeal')
    expect(await prisma.mealPlanEntryComponent.count()).toBe(1)
  })

  it('refuses to add back a left-out ingredient: Undo brings it back', async () => {
    const { alder } = await world()
    await addEntryChange(alder.id, 'plan-alder', 'entry-mon', leaveOut)

    expect(await refusal(addEntryChange(alder.id, 'plan-alder', 'entry-mon', add('cream')))).toBe(
      'alreadyInMeal',
    )
  })
})

describe('removeEntryChange', () => {
  it('restores the original and nulls the tips', async () => {
    const { alder } = await world()
    const { change } = await addEntryChange(alder.id, 'plan-alder', 'entry-mon', replace)
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-mon' },
      data: { preparationTips: TIPS },
    })

    const { components } = await removeEntryChange(alder.id, 'plan-alder', 'entry-mon', change.id)

    expect(components.map((c) => [c.ingredientId, c.quantityPerServing])).toEqual([
      ['pasta', 100],
      ['cream', 50],
    ])
    expect(await tipsOf('entry-mon')).toBeNull()
    expect(await prisma.mealPlanEntryComponent.count()).toBe(0)
  })

  it('refuses on a completed entry and keeps the change', async () => {
    const { alder } = await world()
    const { change } = await addEntryChange(alder.id, 'plan-alder', 'entry-mon', replace)
    await prisma.mealPlanEntry.update({ where: { id: 'entry-mon' }, data: { status: 'completed' } })

    expect(await refusal(removeEntryChange(alder.id, 'plan-alder', 'entry-mon', change.id))).toBe(
      'notPlanned',
    )
    expect(await prisma.mealPlanEntryComponent.count()).toBe(1)
  })

  it("refuses a change of another entry as changeNotFound, and keeps this entry's tips", async () => {
    const { alder } = await world()
    const { change } = await addEntryChange(alder.id, 'plan-alder', 'entry-mon', replace)

    expect(await refusal(removeEntryChange(alder.id, 'plan-alder', 'entry-tue', change.id))).toBe(
      'changeNotFound',
    )
    expect(await tipsOf('entry-tue')).toBe(TIPS)
  })

  it("refuses another household's entry as entryNotFound", async () => {
    const { alder, birch } = await world()
    const { change } = await addEntryChange(alder.id, 'plan-alder', 'entry-mon', replace)

    expect(await refusal(removeEntryChange(birch.id, 'plan-alder', 'entry-mon', change.id))).toBe(
      'entryNotFound',
    )
  })
})
