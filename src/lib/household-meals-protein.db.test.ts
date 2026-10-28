import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getHouseholdMeal } from '@/lib/household-meals-read'
import { loadMeals } from '@/lib/meals/load-meals'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import {
  createHouseholdMeal,
  HouseholdMealError,
  updateHouseholdMeal,
  type HouseholdMealCreateInput,
} from '@/lib/household-meals'

// The household's chosen main protein (HON-1386), against PGlite with no
// mocks. 75 g beef mince (26 g protein / 100 g) and 400 g kidney beans
// (8.7 g) over 3 servings derive Legumes: the beans give 3,480 against
// 1,950 for the mince.

async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const ingredient = (id: string, data: { protein: number; proteinType?: 'beef' | 'legume' }) =>
    prisma.ingredient.create({
      data: {
        id,
        name: id.replace('ing-', ''),
        householdId: alder.id,
        category: 'protein',
        defaultUnit: 'g',
        calories: 100,
        carbs: 10,
        fat: 5,
        ...data,
      },
    })
  await ingredient('ing-mince', { protein: 26, proteinType: 'beef' })
  await ingredient('ing-beans', { protein: 8.7, proteinType: 'legume' })
  await ingredient('ing-buckwheat', { protein: 13 })
  await prisma.meal.create({
    data: {
      id: 'meal-library',
      name: 'Library chili',
      suitableFor: ['dinner'],
      primaryProteinType: 'legume',
    },
  })
  return { alder: alder.id }
}

const MINCE = { ingredientId: 'ing-mince', totalQuantity: 75 }
const BEANS = { ingredientId: 'ing-beans', totalQuantity: 400 }
const BUCKWHEAT = { ingredientId: 'ing-buckwheat', totalQuantity: 150 }

const minceAndBeans: HouseholdMealCreateInput = {
  name: 'Mince and beans',
  kidFriendly: true,
  suitableFor: ['dinner'],
  servings: 3,
  components: [MINCE, BEANS, BUCKWHEAT],
}

async function reasonOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof HouseholdMealError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

const proteinOf = (id: string) =>
  prisma.meal.findUniqueOrThrow({
    where: { id },
    select: { primaryProteinType: true, proteinTypeOverride: true },
  })

describe('createHouseholdMeal with a chosen main protein', () => {
  it('stores the choice as the effective protein', async () => {
    const { alder } = await world()

    const meal = await createHouseholdMeal(alder, { ...minceAndBeans, proteinTypeOverride: 'beef' })

    expect(await proteinOf(meal.id)).toEqual({
      primaryProteinType: 'beef',
      proteinTypeOverride: 'beef',
    })
  })

  it('derives Legumes with no choice', async () => {
    const { alder } = await world()

    const meal = await createHouseholdMeal(alder, minceAndBeans)

    expect(await proteinOf(meal.id)).toEqual({
      primaryProteinType: 'legume',
      proteinTypeOverride: null,
    })
  })

  it('refuses a choice no ingredient carries, and writes nothing', async () => {
    const { alder } = await world()

    expect(
      await reasonOf(createHouseholdMeal(alder, { ...minceAndBeans, proteinTypeOverride: 'fish' })),
    ).toBe('proteinTypeNotInRecipe')
    expect(await prisma.meal.count({ where: { householdId: alder } })).toBe(0)
  })

  it('refuses a choice only a vague component carries', async () => {
    const { alder } = await world()
    const vagueMince = { ingredientId: 'ing-mince', totalQuantity: 0, isVague: true }

    expect(
      await reasonOf(
        createHouseholdMeal(alder, {
          ...minceAndBeans,
          components: [vagueMince, BEANS],
          proteinTypeOverride: 'beef',
        }),
      ),
    ).toBe('proteinTypeNotInRecipe')
  })
})

describe('getHouseholdMeal', () => {
  it('returns the choice and each ingredient protein type for the edit form', async () => {
    const { alder } = await world()
    const { id } = await createHouseholdMeal(alder, {
      ...minceAndBeans,
      proteinTypeOverride: 'beef',
    })

    const meal = await getHouseholdMeal(alder, id, 'en')

    expect(meal.proteinTypeOverride).toBe('beef')
    expect(meal.primaryProteinType).toBe('beef')
    expect(meal.components.map((c) => [c.ingredientId, c.ingredient.proteinType]).sort()).toEqual([
      ['ing-beans', 'legume'],
      ['ing-buckwheat', null],
      ['ing-mince', 'beef'],
    ])
  })
})

describe('updateHouseholdMeal with a chosen main protein', () => {
  async function automaticMeal() {
    const { alder } = await world()
    const { id } = await createHouseholdMeal(alder, minceAndBeans)
    return { alder, id }
  }

  it('sets a choice sent without components, against the stored components', async () => {
    const { alder, id } = await automaticMeal()

    await updateHouseholdMeal(alder, id, { proteinTypeOverride: 'beef' })

    expect(await proteinOf(id)).toEqual({ primaryProteinType: 'beef', proteinTypeOverride: 'beef' })
  })

  it('keeps the stored choice when the key is absent, with or without components', async () => {
    const { alder, id } = await automaticMeal()
    await updateHouseholdMeal(alder, id, { proteinTypeOverride: 'beef' })

    await updateHouseholdMeal(alder, id, { name: 'Beef chili' })
    expect(await proteinOf(id)).toEqual({ primaryProteinType: 'beef', proteinTypeOverride: 'beef' })

    await updateHouseholdMeal(alder, id, { components: minceAndBeans.components })
    expect(await proteinOf(id)).toEqual({ primaryProteinType: 'beef', proteinTypeOverride: 'beef' })
  })

  it('clears the choice on null and stores the derived value', async () => {
    const { alder, id } = await automaticMeal()
    await updateHouseholdMeal(alder, id, { proteinTypeOverride: 'beef' })

    await updateHouseholdMeal(alder, id, { proteinTypeOverride: null })

    expect(await proteinOf(id)).toEqual({ primaryProteinType: 'legume', proteinTypeOverride: null })
  })

  it('refuses a choice the recipe does not carry, and changes nothing', async () => {
    const { alder, id } = await automaticMeal()
    await updateHouseholdMeal(alder, id, { proteinTypeOverride: 'beef' })

    expect(
      await reasonOf(updateHouseholdMeal(alder, id, { name: 'Fish', proteinTypeOverride: 'fish' })),
    ).toBe('proteinTypeNotInRecipe')

    const meal = await prisma.meal.findUniqueOrThrow({ where: { id } })
    expect(meal.name).toBe('Mince and beans')
    expect(meal.proteinTypeOverride).toBe('beef')
  })

  it('refuses a sent choice that the sent components no longer carry', async () => {
    const { alder, id } = await automaticMeal()

    expect(
      await reasonOf(
        updateHouseholdMeal(alder, id, {
          components: [BEANS],
          proteinTypeOverride: 'beef',
        }),
      ),
    ).toBe('proteinTypeNotInRecipe')
    expect(await prisma.mealComponent.count({ where: { mealId: id } })).toBe(3)
  })

  it('clears the stored choice when new components remove its ingredient', async () => {
    const { alder, id } = await automaticMeal()
    await updateHouseholdMeal(alder, id, { proteinTypeOverride: 'beef' })

    await updateHouseholdMeal(alder, id, {
      components: [BEANS, BUCKWHEAT],
    })

    expect(await proteinOf(id)).toEqual({ primaryProteinType: 'legume', proteinTypeOverride: null })
  })

  it('refuses a library meal, and leaves its protein alone', async () => {
    const { alder } = await world()

    expect(
      await reasonOf(updateHouseholdMeal(alder, 'meal-library', { proteinTypeOverride: 'beef' })),
    ).toBe('mealNotFound')
    expect(await proteinOf('meal-library')).toEqual({
      primaryProteinType: 'legume',
      proteinTypeOverride: null,
    })
  })
})

describe('the cards that show the protein badge', () => {
  it('read Beef for a recipe whose household chose Beef over derived Legumes', async () => {
    const { alder } = await world()
    const { id } = await createHouseholdMeal(alder, {
      ...minceAndBeans,
      proteinTypeOverride: 'beef',
    })
    await prisma.mealPlan.create({
      data: {
        id: 'plan-alder',
        householdId: alder,
        entries: {
          create: { date: new Date('2026-10-19T00:00:00Z'), mealType: 'dinner', mealId: id },
        },
      },
    })

    // The meal selector reads `GET /api/meals`, which reads `loadMeals`.
    const { meals } = await loadMeals(
      { id: alder, locale: 'en', timezone: 'Europe/Tallinn', preferences: null },
      { source: 'custom' },
    )
    expect(meals.find((meal) => meal.id === id)?.primaryProteinType).toBe('beef')

    // The planner card reads `GET /api/entries`, which reads `loadPlanEntries`.
    const { entries } = await loadPlanEntries(
      { id: alder, locale: 'en', _count: { members: 0 }, members: [] },
      { startDate: new Date('2026-10-19T00:00:00Z'), endDate: new Date('2026-10-20T00:00:00Z') },
    )
    expect(entries.map((entry) => entry.meal?.primaryProteinType)).toEqual(['beef'])
  })
})
