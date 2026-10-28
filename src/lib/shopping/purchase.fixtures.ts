import { prisma } from '@/lib/prisma'
import { ShoppingPlanError, type ShoppingPlanRefusal } from '@/lib/shopping/load-shopping-list'

// Shared by the `purchase.*.db.test.ts` files.

export const DAY_MS = 24 * 60 * 60 * 1000

export function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY_MS)
}

/**
 * Two global ingredients: rice, with an Estonian name, and milk. Alder is an
 * English household with a plan and its own ingredient, a home-made stock.
 * Birch is a second household with a plan and its own ingredient, a chutney.
 */
export async function world() {
  await prisma.ingredient.create({
    data: {
      id: 'ing-rice',
      name: 'rice',
      category: 'carb',
      defaultUnit: 'g',
      calories: 130,
      protein: 3,
      carbs: 28,
      fat: 0,
      translations: { create: { locale: 'et', name: 'riis' } },
    },
  })
  await prisma.ingredient.create({
    data: {
      id: 'ing-milk',
      name: 'milk',
      category: 'dairy',
      defaultUnit: 'g',
      calories: 60,
      protein: 3,
      carbs: 5,
      fat: 3,
    },
  })
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  await prisma.ingredient.create({
    data: {
      id: 'ing-alder-stock',
      name: 'home-made stock',
      householdId: alder.id,
      category: 'condiment',
      defaultUnit: 'g',
      calories: 10,
      protein: 1,
      carbs: 1,
      fat: 0,
    },
  })
  await prisma.ingredient.create({
    data: {
      id: 'ing-birch-chutney',
      name: 'chutney',
      householdId: birch.id,
      category: 'condiment',
      defaultUnit: 'g',
      calories: 200,
      protein: 1,
      carbs: 45,
      fat: 0,
    },
  })
  return { alder, birch }
}

export async function pantryRow(householdId: string, ingredientId: string) {
  return prisma.pantryItem.findUnique({
    where: { householdId_ingredientId: { householdId, ingredientId } },
    select: { quantity: true, isStaple: true },
  })
}

export async function refusalOf(promise: Promise<unknown>): Promise<ShoppingPlanRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ShoppingPlanError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}
