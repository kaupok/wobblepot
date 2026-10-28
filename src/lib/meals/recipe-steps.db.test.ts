import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  freshRecipeSteps,
  loadRecipeForSteps,
  recipeStepsRequest,
  RecipeStepsError,
  saveRecipeSteps,
  type RecipeStepsRefusal,
} from '@/lib/meals/recipe-steps'
import { stepsInputHash } from '@/lib/landing/steps-input-hash'

// Runs against PGlite through the `unit-db` project, with no mocks: rows are
// written with Prisma and read or changed through the lib functions (HON-1338).

const STEPS = { steps: ['Boil the pasta.'], pitfalls: ['Salt the water.'] }

/**
 * Alder owns a pasta recipe with an Estonian translation and a deleted soup.
 * Birch owns a stew. Porridge is a library meal, gruel a deleted one.
 */
async function world() {
  await prisma.ingredient.create({
    data: {
      id: 'ing-pasta',
      name: 'Pasta',
      category: 'carb',
      defaultUnit: 'g',
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
      translations: { create: { locale: 'et', name: 'Pasta (et)' } },
    },
  })
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  await prisma.meal.create({
    data: {
      id: 'meal-pasta',
      name: 'Pasta',
      timeMinutes: 20,
      householdId: alder.id,
      components: { create: { ingredientId: 'ing-pasta', quantityPerServing: 100 } },
      translations: { create: { locale: 'et', name: 'Pasta eesti keeles' } },
    },
  })
  await prisma.meal.create({
    data: { id: 'meal-soup', name: 'Soup', householdId: alder.id, deletedAt: new Date() },
  })
  await prisma.meal.create({ data: { id: 'meal-stew', name: 'Stew', householdId: birch.id } })
  await prisma.meal.create({
    data: {
      id: 'meal-porridge',
      name: 'Porridge',
      components: { create: { ingredientId: 'ing-pasta', quantityPerServing: 80 } },
    },
  })
  await prisma.meal.create({ data: { id: 'meal-gruel', name: 'Gruel', deletedAt: new Date() } })
  return { alder: alder.id }
}

async function refusalOf(promise: Promise<unknown>): Promise<RecipeStepsRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof RecipeStepsError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

/** Stores steps for the pasta as the route would, at `servings` in `locale`. */
async function storeAt(alder: string, servings: number, locale = 'en') {
  const meal = await loadRecipeForSteps(alder, 'meal-pasta', locale)
  const { inputHash } = recipeStepsRequest(meal, locale, servings)
  await saveRecipeSteps({ mealId: 'meal-pasta', locale, servings, inputHash }, STEPS)
}

async function freshAt(alder: string, servings: number, locale = 'en') {
  const meal = await loadRecipeForSteps(alder, 'meal-pasta', locale)
  return freshRecipeSteps(meal, recipeStepsRequest(meal, locale, servings).inputHash)
}

describe('loadRecipeForSteps', () => {
  it("loads the household's own recipe with its components", async () => {
    const { alder } = await world()

    const meal = await loadRecipeForSteps(alder, 'meal-pasta', 'en')

    expect(meal.name).toBe('Pasta')
    expect(meal.components.map((c) => c.quantityPerServing)).toEqual([100])
  })

  it('loads a library meal with its components (HON-1351)', async () => {
    const { alder } = await world()

    const meal = await loadRecipeForSteps(alder, 'meal-porridge', 'en')

    expect(meal.name).toBe('Porridge')
    expect(meal.householdId).toBeNull()
    expect(meal.components.map((c) => c.quantityPerServing)).toEqual([80])
  })

  it("refuses another household's recipe, a deleted meal and an unknown id", async () => {
    const { alder } = await world()

    expect(await refusalOf(loadRecipeForSteps(alder, 'meal-stew', 'en'))).toBe('not_found')
    expect(await refusalOf(loadRecipeForSteps(alder, 'meal-soup', 'en'))).toBe('not_found')
    expect(await refusalOf(loadRecipeForSteps(alder, 'meal-gruel', 'en'))).toBe('not_found')
    expect(await refusalOf(loadRecipeForSteps(alder, 'meal-nothing', 'en'))).toBe('not_found')
  })

  it('names the meal and its ingredients in the locale', async () => {
    const { alder } = await world()

    const meal = await loadRecipeForSteps(alder, 'meal-pasta', 'et')
    const { input } = recipeStepsRequest(meal, 'et', 2)

    expect(input.mealName).toBe('Pasta eesti keeles')
    expect(input.components.map((c) => c.name)).toEqual(['Pasta (et)'])
  })
})

describe('recipeStepsRequest', () => {
  it("follows the household's own notes", async () => {
    const { alder } = await world()
    await prisma.meal.update({
      where: { id: 'meal-pasta' },
      data: { preparationNotes: 'Bake for 20 minutes.' },
    })

    const meal = await loadRecipeForSteps(alder, 'meal-pasta', 'en')

    expect(recipeStepsRequest(meal, 'en', 2).notes).toBe('Bake for 20 minutes.')
  })

  it('gives a library meal no notes, so the full prompt writes its steps (HON-1351)', async () => {
    const { alder } = await world()
    await prisma.meal.update({
      where: { id: 'meal-porridge' },
      data: { preparationNotes: 'Stir often.' },
    })

    const meal = await loadRecipeForSteps(alder, 'meal-porridge', 'en')
    const { input, notes, inputHash } = recipeStepsRequest(meal, 'en', 2)

    expect(notes).toBeNull()
    // The hash `pnpm steps:library` and the landing demo check for the row.
    expect(inputHash).toBe(stepsInputHash(input))
  })
})

describe('saveRecipeSteps and freshRecipeSteps', () => {
  it('stores one row for the meal, locale and servings, and reads it back fresh', async () => {
    const { alder } = await world()

    await storeAt(alder, 2.5)

    const rows = await prisma.mealPreparationSteps.findMany({ where: { mealId: 'meal-pasta' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ locale: 'en', servings: 2.5 })
    expect(await freshAt(alder, 2.5)).toEqual(STEPS)
  })

  it('reads nothing at other servings, and a serving change replaces the row', async () => {
    const { alder } = await world()
    await storeAt(alder, 2)

    expect(await freshAt(alder, 4)).toBeNull()

    await storeAt(alder, 4)
    const rows = await prisma.mealPreparationSteps.findMany({ where: { mealId: 'meal-pasta' } })
    expect(rows.map((row) => row.servings)).toEqual([4])
  })

  it('keeps one row per locale', async () => {
    const { alder } = await world()
    await storeAt(alder, 2, 'en')

    expect(await freshAt(alder, 2, 'et')).toBeNull()
    await storeAt(alder, 2, 'et')

    expect(await prisma.mealPreparationSteps.count({ where: { mealId: 'meal-pasta' } })).toBe(2)
    expect(await freshAt(alder, 2, 'en')).toEqual(STEPS)
  })

  it('goes stale after the name changes', async () => {
    const { alder } = await world()
    await storeAt(alder, 2)

    await prisma.meal.update({ where: { id: 'meal-pasta' }, data: { name: 'Pasta bake' } })

    expect(await freshAt(alder, 2)).toBeNull()
  })

  it('goes stale after an ingredient amount changes', async () => {
    const { alder } = await world()
    await storeAt(alder, 2)

    await prisma.mealComponent.updateMany({
      where: { mealId: 'meal-pasta' },
      data: { quantityPerServing: 120 },
    })

    expect(await freshAt(alder, 2)).toBeNull()
  })

  it('goes stale after the notes change', async () => {
    const { alder } = await world()
    await storeAt(alder, 2)

    await prisma.meal.update({
      where: { id: 'meal-pasta' },
      data: { preparationNotes: 'Bake for 20 minutes.' },
    })

    expect(await freshAt(alder, 2)).toBeNull()
  })
})
