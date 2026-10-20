import { prisma } from '@/lib/prisma'

// The households, meals and entries the `entries`, `create-entry` and `fill-entries` db tests
// share. Each test file runs against a fresh PGlite database (HON-1186).

const INGREDIENTS = ['ing-apple', 'ing-beef', 'ing-salt', 'ing-rice'] as const
export type IngredientId = (typeof INGREDIENTS)[number]

/**
 * Alder: two adults and a toddler at 0.5×, so 2.5 servings by default. Its plan
 * has a planned stew dinner. Stew is 100 g beef, 20 g apple and 2 g salt per
 * serving; salad is 50 g apple and 30 g rice. Birch is a second household with
 * its own plan, entry, custom meal and pantry.
 */
export async function world() {
  for (const id of INGREDIENTS) {
    await prisma.ingredient.create({
      data: {
        id,
        name: id,
        category: 'spice',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  }
  const member = (name: string, portionMultiplier: number) => ({
    name,
    preferences: { create: { portionMultiplier } },
  })
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      members: { create: [member('A', 1), member('B', 1), member('Toddler', 0.5)] },
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const birch = await prisma.household.create({
    data: {
      name: 'Birch',
      members: { create: [member('C', 1)] },
      mealPlans: { create: { id: 'plan-birch' } },
    },
  })
  const meal = (
    id: string,
    components: Partial<Record<IngredientId, number>>,
    householdId: string | null = null,
  ) =>
    prisma.meal.create({
      data: {
        id,
        name: id,
        householdId,
        components: {
          create: Object.entries(components).map(([ingredientId, quantityPerServing]) => ({
            ingredientId,
            quantityPerServing,
          })),
        },
      },
    })
  await meal('meal-stew', { 'ing-beef': 100, 'ing-apple': 20, 'ing-salt': 2 })
  await meal('meal-salad', { 'ing-apple': 50, 'ing-rice': 30 })
  await meal('meal-empty', {})
  await meal('meal-birch', { 'ing-beef': 10 }, birch.id)
  await prisma.meal.create({
    data: { id: 'meal-deleted', name: 'gone', deletedAt: new Date() },
  })
  await entry('entry-alder', { planId: 'plan-alder', mealId: 'meal-stew' })
  await entry('entry-birch', { planId: 'plan-birch', mealId: 'meal-birch' })
  return { alder, birch }
}

export async function entry(
  id: string,
  data: { planId?: string; mealId?: string | null } & Record<string, unknown> = {},
) {
  return prisma.mealPlanEntry.create({
    data: {
      id,
      planId: 'plan-alder',
      date: new Date('2026-10-14T00:00:00Z'),
      mealType: 'dinner',
      ...data,
    },
  })
}

/** The stored entry, Alder's dinner by default. */
export const readEntry = (id = 'entry-alder') =>
  prisma.mealPlanEntry.findUniqueOrThrow({ where: { id } })
