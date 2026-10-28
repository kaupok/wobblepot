import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Allergen } from '@/generated/prisma/enums'
import { HouseholdMealError } from '@/lib/household-meal-error'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { presentMealImage } from '@/lib/meal-images/present'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import type { Locale } from '@/lib/i18n/locales'

/**
 * The read side of a household's own recipes: the list behind `GET
 * /api/households/me/meals` and the `/recipes` prefetch, and the one recipe
 * behind `GET /api/households/me/meals/[id]`. The writes live in
 * `household-meals.ts`; both are tested in `household-meals.db.test.ts`.
 */

export interface ListHouseholdMealsOptions {
  householdId: string
  /** Resolved household locale (`resolveHouseholdLocale`). */
  locale: Locale
  search?: string | null
  cursor?: string | null
  limit?: number
  includeDeleted?: boolean
}

export const HOUSEHOLD_MEALS_DEFAULT_LIMIT = 30

/**
 * One page of a household's recipe library, newest first, keyset-paginated by
 * meal id. Shared by `GET /api/households/me/meals` and the `/recipes` server
 * prefetch (HON-770), so the page the server hydrates is the page the client
 * would have fetched.
 */
export async function listHouseholdMeals({
  householdId,
  locale,
  search = null,
  cursor = null,
  limit = HOUSEHOLD_MEALS_DEFAULT_LIMIT,
  includeDeleted = false,
}: ListHouseholdMealsOptions) {
  const baseQuery = {
    where: {
      householdId,
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      preparationNotes: true,
      sourceUrl: true,
      timeMinutes: true,
      kidFriendly: true,
      primaryProteinType: true,
      suitableFor: true,
      servings: true,
      imageUrl: true,
      imageStatus: true,
      imageHue: true,
      imagePromptVersion: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      components: {
        select: {
          ingredientId: true,
          quantityPerServing: true,
          isVague: true,
          originalPhrase: true,
          ingredient: {
            select: {
              id: true,
              name: true,
              category: true,
              defaultUnit: true,
              measuredByVolume: true,
              pieceDisplay: true,
              gramsPerPiece: true,
              calories: true,
              protein: true,
              carbs: true,
              fat: true,
              allergens: true,
              proteinType: true,
              ...ingredientTranslationsInclude(locale),
            },
          },
        },
      },
      favoritedBy: {
        where: { householdId },
        select: { id: true },
      },
      ...mealTranslationsInclude(locale),
    },
    orderBy: [{ updatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: limit + 1,
  }

  // Prisma 7 answers an unknown cursor with no rows, so the page is empty and
  // `nextCursor` is `null`; the client ends the list (HON-1232).
  const meals = await prisma.meal.findMany({
    ...baseQuery,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasNext = meals.length > limit
  const pageMeals = hasNext ? meals.slice(0, limit) : meals
  const nextCursor = hasNext ? (pageMeals.at(-1)?.id ?? null) : null

  const mealsWithNutrition = pageMeals.map((meal) => {
    const nutrition = computeMealNutrition(meal.components)

    const allergens = [...new Set(meal.components.flatMap((comp) => comp.ingredient.allergens))]
    const translatedMeal = translateMeal(meal, locale)

    return {
      id: translatedMeal.id,
      name: translatedMeal.name,
      description: translatedMeal.description,
      preparationNotes: translatedMeal.preparationNotes,
      sourceUrl: meal.sourceUrl,
      timeMinutes: translatedMeal.timeMinutes,
      kidFriendly: translatedMeal.kidFriendly,
      primaryProteinType: translatedMeal.primaryProteinType,
      suitableFor: translatedMeal.suitableFor,
      servings: meal.servings,
      isCustom: true,
      isFavorite: meal.favoritedBy.length > 0,
      ...presentMealImage(meal),
      deletedAt: meal.deletedAt,
      createdAt: meal.createdAt,
      updatedAt: meal.updatedAt,
      components: meal.components.map((comp) => {
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
      nutrition: {
        calories: Math.round(nutrition.calories),
        protein: Math.round(nutrition.protein),
        carbs: Math.round(nutrition.carbs),
        fat: Math.round(nutrition.fat),
      },
      allergens,
    }
  })

  return { meals: mealsWithNutrition, nextCursor }
}

export const INGREDIENT_NUTRITION_SELECT = {
  id: true,
  name: true,
  category: true,
  defaultUnit: true,
  measuredByVolume: true,
  pieceDisplay: true,
  gramsPerPiece: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
  allergens: true,
  proteinType: true,
} as const

/** Rounded macros and the deduplicated allergens of a meal's components. */
export function summarise(
  components: (Parameters<typeof computeMealNutrition>[0][number] & {
    ingredient: { allergens: Allergen[] }
  })[],
) {
  const nutrition = computeMealNutrition(components)
  return {
    nutrition: {
      calories: Math.round(nutrition.calories),
      protein: Math.round(nutrition.protein),
      carbs: Math.round(nutrition.carbs),
      fat: Math.round(nutrition.fat),
    },
    allergens: [...new Set(components.flatMap((comp) => comp.ingredient.allergens))],
  }
}

/**
 * One of the household's recipes in the household's locale, with its
 * nutrition and allergens. A deleted recipe is still returned, with its
 * `deletedAt`, so a past plan entry can open it.
 */
export async function getHouseholdMeal(householdId: string, mealId: string, locale: Locale) {
  const meal = await prisma.meal.findFirst({
    where: { id: mealId, householdId },
    select: {
      id: true,
      name: true,
      description: true,
      preparationNotes: true,
      sourceUrl: true,
      timeMinutes: true,
      kidFriendly: true,
      primaryProteinType: true,
      proteinTypeOverride: true,
      suitableFor: true,
      servings: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      components: {
        select: {
          ingredientId: true,
          quantityPerServing: true,
          isVague: true,
          originalPhrase: true,
          ingredient: {
            select: { ...INGREDIENT_NUTRITION_SELECT, ...ingredientTranslationsInclude(locale) },
          },
        },
      },
      favoritedBy: {
        where: { householdId },
        select: { id: true },
      },
      ...mealTranslationsInclude(locale),
    },
  })

  if (!meal) throw new HouseholdMealError('mealNotFound')

  const translatedMeal = translateMeal(meal, locale)

  return {
    id: translatedMeal.id,
    name: translatedMeal.name,
    description: translatedMeal.description,
    preparationNotes: translatedMeal.preparationNotes,
    sourceUrl: meal.sourceUrl,
    timeMinutes: translatedMeal.timeMinutes,
    kidFriendly: translatedMeal.kidFriendly,
    primaryProteinType: translatedMeal.primaryProteinType,
    proteinTypeOverride: meal.proteinTypeOverride,
    suitableFor: translatedMeal.suitableFor,
    servings: meal.servings,
    isCustom: true,
    isFavorite: meal.favoritedBy.length > 0,
    deletedAt: meal.deletedAt,
    createdAt: meal.createdAt,
    updatedAt: meal.updatedAt,
    components: meal.components.map((comp) => {
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
          calories: comp.ingredient.calories,
          protein: comp.ingredient.protein,
          carbs: comp.ingredient.carbs,
          fat: comp.ingredient.fat,
          proteinType: comp.ingredient.proteinType,
        },
      }
    }),
    ...summarise(meal.components),
  }
}
