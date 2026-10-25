import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { loadMealPlan, MealPlanReadError, type MealPlanReadRefusal } from '@/lib/meal-plans/plans'

// Runs against PGlite through the `unit-db` project, with no mocks: rows are
// written with Prisma and read through `loadMealPlan` (HON-1206). The route
// test covers only how the route maps these answers.

/**
 * Alder's plan has an empty breakfast on 15 October and a stew dinner on
 * 14 October, written in that order so the read has to sort them. The stew is
 * 100 g beef per serving, with an Estonian name for the meal and the beef.
 * Birch is a second household with its own plan.
 */
async function world() {
  await prisma.ingredient.create({
    data: {
      id: 'ing-beef',
      name: 'beef',
      category: 'protein',
      defaultUnit: 'g',
      calories: 250,
      protein: 26,
      carbs: 0,
      fat: 17,
      translations: { create: { locale: 'et', name: 'veiseliha' } },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-stew',
      name: 'Beef stew',
      kidFriendly: true,
      timeMinutes: 90,
      preparationNotes: 'Brown the beef first.',
      primaryProteinType: 'beef',
      components: { create: { ingredientId: 'ing-beef', quantityPerServing: 100 } },
      translations: { create: { locale: 'et', name: 'Veisehautis' } },
    },
  })
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-breakfast',
      planId: 'plan-alder',
      date: new Date('2026-10-15T00:00:00Z'),
      mealType: 'breakfast',
    },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-dinner',
      planId: 'plan-alder',
      date: new Date('2026-10-14T00:00:00Z'),
      mealType: 'dinner',
      mealId: 'meal-stew',
      servingOverride: 4,
    },
  })
  return { alder, birch }
}

async function refusalOf(promise: Promise<unknown>): Promise<MealPlanReadRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof MealPlanReadError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

describe('loadMealPlan', () => {
  it("returns the household's plan with its entries in date order", async () => {
    const { alder } = await world()

    const plan = await loadMealPlan(alder.id, 'plan-alder', 'en')

    expect(plan).toEqual({
      id: 'plan-alder',
      entries: [
        {
          id: 'entry-dinner',
          date: '2026-10-14',
          mealType: 'dinner',
          status: 'planned',
          servingOverride: 4,
          meal: {
            id: 'meal-stew',
            name: 'Beef stew',
            kidFriendly: true,
            timeMinutes: 90,
            preparationNotes: 'Brown the beef first.',
            primaryProteinType: 'beef',
            // 100 g at 250 kcal, 26 g protein and 17 g fat per 100 g.
            nutrition: { calories: 250, protein: 26, carbs: 0, fat: 17 },
            components: [
              {
                ingredientId: 'ing-beef',
                quantityPerServing: 100,
                isVague: false,
                originalPhrase: null,
                ingredient: {
                  id: 'ing-beef',
                  name: 'beef',
                  category: 'protein',
                  defaultUnit: 'g',
                  measuredByVolume: false,
                  pieceDisplay: 'none',
                  gramsPerPiece: null,
                },
              },
            ],
          },
        },
        {
          id: 'entry-breakfast',
          date: '2026-10-15',
          mealType: 'breakfast',
          status: 'planned',
          servingOverride: null,
          meal: null,
        },
      ],
    })
  })

  it('names the meal and its ingredients in the given locale', async () => {
    const { alder } = await world()

    const plan = await loadMealPlan(alder.id, 'plan-alder', 'et')
    const meal = plan.entries[0]!.meal!

    expect(meal.name).toBe('Veisehautis')
    expect(meal.components[0]!.ingredient.name).toBe('veiseliha')
  })

  it('refuses an unknown plan as planNotFound', async () => {
    const { alder } = await world()

    expect(await refusalOf(loadMealPlan(alder.id, 'plan-missing', 'en'))).toBe('planNotFound')
  })

  it("refuses another household's plan as otherHousehold", async () => {
    const { alder, birch } = await world()

    expect(await refusalOf(loadMealPlan(alder.id, 'plan-birch', 'en'))).toBe('otherHousehold')
    expect(await refusalOf(loadMealPlan(birch.id, 'plan-alder', 'en'))).toBe('otherHousehold')
  })
})
