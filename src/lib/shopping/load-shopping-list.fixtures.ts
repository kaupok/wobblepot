import type { IngredientCategory } from '@/generated/prisma/enums'
import { prisma } from '@/lib/prisma'
import { ShoppingPlanError, type ShoppingPlanRefusal } from '@/lib/shopping/load-shopping-list'

// The rows the two shopping-list loader tests share (HON-1208):
// load-shopping-list.db.test.ts and load-shopping-list.plan.db.test.ts.

// Thursday 15 October 2026, noon in Tallinn. Only `Date` is faked, so "today"
// and the relative labels are fixed and PGlite's timers still run.
export const NOW = new Date('2026-10-15T09:00:00Z')
export const PLAN_CREATED_AT = new Date('2026-10-10T08:00:00Z')
// After the plan was created, so a "have some" here would read as a purchase
// if the item stayed on the list.
export const PANTRY_UPDATED_AT = new Date('2026-10-14T12:00:00Z')

export async function ingredient(
  id: string,
  name: string,
  category: IngredientCategory,
  {
    et,
    measuredByVolume = false,
    subcategory,
  }: { et?: string; measuredByVolume?: boolean; subcategory?: string } = {},
) {
  await prisma.ingredient.create({
    data: {
      id,
      name,
      category,
      subcategory,
      defaultUnit: 'g',
      measuredByVolume,
      calories: 100,
      protein: 10,
      carbs: 10,
      fat: 1,
      ...(et ? { translations: { create: { locale: 'et', name: et } } } : {}),
    },
  })
}

export async function household(id: string, locale = 'en') {
  return prisma.household.create({
    data: {
      id,
      name: id,
      locale,
      timezone: 'Europe/Tallinn',
      mealPlans: { create: { id: `plan-${id}`, createdAt: PLAN_CREATED_AT } },
    },
  })
}

/** A planned entry on `date` (YYYY-MM-DD) cooking `mealId` for `servings`. */
export async function entry(planId: string, date: string, mealId: string, servings: number) {
  await prisma.mealPlanEntry.create({
    data: {
      planId,
      date: new Date(`${date}T00:00:00Z`),
      mealType: 'dinner',
      mealId,
      servingOverride: servings,
    },
  })
}

/**
 * Alder's plan, read on 15 October:
 *
 * - 14 Oct (yesterday): stew for 4, which no list may count.
 * - 15 Oct (today): bowl for 4, so 1500 g rice, 1500 g oat milk (measured by
 *   volume) and salt "to taste".
 * - 16 Oct (tomorrow) and 18 Oct: stew for 4 and 2, so 900 g chicken and 6 g
 *   pepper. The pepper is vague with no phrase, so it shows as an amount.
 *
 * Rice, milk and chicken carry Estonian names.
 */
export async function world({ locale = 'en' }: { locale?: string } = {}) {
  await ingredient('ing-test-chicken', 'chicken thigh', 'protein', { et: 'kanakints' })
  await ingredient('ing-test-rice', 'basmati rice', 'carb', { et: 'basmatiriis' })
  await ingredient('ing-test-milk', 'oat milk', 'dairy', {
    et: 'kaerajook',
    measuredByVolume: true,
  })
  await ingredient('ing-test-salt', 'sea salt', 'spice')
  await ingredient('ing-test-pepper', 'black pepper', 'spice')
  await prisma.meal.create({
    data: {
      id: 'meal-test-stew',
      name: 'Chicken stew',
      components: {
        create: [
          { ingredientId: 'ing-test-chicken', quantityPerServing: 150 },
          { ingredientId: 'ing-test-pepper', quantityPerServing: 1, isVague: true },
        ],
      },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-test-bowl',
      name: 'Rice bowl',
      components: {
        create: [
          { ingredientId: 'ing-test-rice', quantityPerServing: 375 },
          { ingredientId: 'ing-test-milk', quantityPerServing: 375 },
          {
            ingredientId: 'ing-test-salt',
            quantityPerServing: 1,
            isVague: true,
            originalPhrase: 'to taste',
          },
        ],
      },
    },
  })
  const alder = await household('alder', locale)
  await entry('plan-alder', '2026-10-14', 'meal-test-stew', 4)
  await entry('plan-alder', '2026-10-15', 'meal-test-bowl', 4)
  await entry('plan-alder', '2026-10-16', 'meal-test-stew', 4)
  await entry('plan-alder', '2026-10-18', 'meal-test-stew', 2)
  return { alder }
}

/** The listed items across every group, by ingredient id. */
export function itemsById<T extends { ingredientId: string }>(list: { groups: { items: T[] }[] }) {
  return Object.fromEntries(list.groups.flatMap((g) => g.items).map((i) => [i.ingredientId, i]))
}

export async function refusalOf(promise: Promise<unknown>): Promise<ShoppingPlanRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ShoppingPlanError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}
