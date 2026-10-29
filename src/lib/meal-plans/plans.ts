import 'server-only'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { toDateString } from '@/lib/meal-planning/dates'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'

/**
 * The read behind `GET /api/meal-plans/[id]` (HON-1206). The route owns the
 * session and the household; this owns the query and the shape the client
 * reads, and is tested against a database in `plans.db.test.ts`.
 */

/**
 * Why `loadMealPlan` refused. The route maps each one to its status:
 *
 * - `planNotFound`: no plan has this id (404).
 * - `otherHousehold`: the plan belongs to another household (403).
 */
export type MealPlanReadRefusal = 'planNotFound' | 'otherHousehold'

export class MealPlanReadError extends Error {
  constructor(readonly reason: MealPlanReadRefusal) {
    super(`Meal plan read refused: ${reason}`)
    this.name = 'MealPlanReadError'
  }
}

/**
 * A plan with its entries in date order, each meal translated into `locale`
 * with its nutrition and components. Throws `MealPlanReadError` for a plan
 * that does not exist or is not the household's.
 */
export async function loadMealPlan(householdId: string, planId: string, locale: string) {
  const plan = await prisma.mealPlan.findUnique({
    where: { id: planId },
    include: {
      entries: {
        include: {
          meal: {
            include: {
              components: {
                include: {
                  ingredient: {
                    include: ingredientTranslationsInclude(locale),
                  },
                },
              },
              ...mealTranslationsInclude(locale),
            },
          },
        },
        orderBy: { date: 'asc' },
      },
    },
  })

  if (!plan) {
    throw new MealPlanReadError('planNotFound')
  }

  if (plan.householdId !== householdId) {
    throw new MealPlanReadError('otherHousehold')
  }

  return {
    id: plan.id,
    entries: plan.entries.map((entry) => ({
      id: entry.id,
      date: toDateString(entry.date),
      mealType: entry.mealType,
      status: entry.status,
      servingOverride: entry.servingOverride,
      meal: entry.meal
        ? (() => {
            const translatedMeal = translateMeal(entry.meal, locale)
            return {
              id: translatedMeal.id,
              name: translatedMeal.name,
              kidFriendly: translatedMeal.kidFriendly,
              timeMinutes: translatedMeal.timeMinutes,
              preparationNotes: translatedMeal.preparationNotes,
              primaryProteinType: translatedMeal.primaryProteinType,
              nutrition: computeMealNutrition(entry.meal.components),
              components: entry.meal.components.map((comp) => {
                const translatedIngredient = translateIngredient(comp.ingredient, locale)
                return {
                  ingredientId: comp.ingredientId,
                  quantityPerServing: comp.quantityPerServing,
                  isVague: comp.isVague,
                  originalPhrase: comp.originalPhrase,
                  ingredient: {
                    id: translatedIngredient.id,
                    name: translatedIngredient.name,
                    category: translatedIngredient.category,
                    defaultUnit: translatedIngredient.defaultUnit,
                    measuredByVolume: translatedIngredient.measuredByVolume,
                    pieceDisplay: translatedIngredient.pieceDisplay,
                    gramsPerPiece: translatedIngredient.gramsPerPiece,
                  },
                }
              }),
            }
          })()
        : null,
    })),
  }
}

/**
 * The household's plan id, created when the household has none yet. A
 * household has one plan (`householdId @unique`), so an upsert cannot make a
 * second one. Unlike `createEmptyPlan`, it leaves every entry alone.
 */
export async function findOrCreateMealPlan(householdId: string): Promise<string> {
  const plan = await prisma.mealPlan.upsert({
    where: { householdId },
    create: { householdId },
    update: {},
    select: { id: true },
  })
  return plan.id
}
