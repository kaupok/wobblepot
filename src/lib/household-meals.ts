import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { presentMealImage } from '@/lib/meal-images/present'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'

export interface ListHouseholdMealsOptions {
  householdId: string
  locale: string | null | undefined
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

  let meals
  try {
    meals = await prisma.meal.findMany({
      ...baseQuery,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  } catch (error) {
    // Stale or unknown cursor → Prisma throws P2025. Fall back to first page
    // so bookmarks/refreshes with a since-deleted meal id don't 500.
    if (cursor && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      meals = await prisma.meal.findMany(baseQuery)
    } else {
      throw error
    }
  }

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
