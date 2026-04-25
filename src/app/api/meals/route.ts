import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import type { Allergen, MealType, ProteinType } from '@/generated/prisma/enums'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { captureApiError } from '@/lib/errors'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const SIMILARITY_THRESHOLD = 0.25
// Cap fuzzy search results to prevent loading too many meals into memory
// This is generous enough for any realistic search pagination needs
const FUZZY_SEARCH_CAP = 200

interface FuzzyMealMatch {
  id: string
  similarity: number
}

export async function GET(request: NextRequest) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership with preferences
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // Parse query params
  const searchParams = request.nextUrl.searchParams
  const mealType = searchParams.get('mealType') as MealType | null
  const proteinType = searchParams.get('proteinType') as ProteinType | null
  const kidFriendlyParam = searchParams.get('kidFriendly')
  const kidFriendly =
    kidFriendlyParam === 'true' ? true : kidFriendlyParam === 'false' ? false : null
  const search = searchParams.get('search')?.trim() || null
  const source = searchParams.get('source') as 'all' | 'system' | 'custom' | 'favorites' | null
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  )
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

  // Get preferences for allergen filtering
  const preferences = household.preferences
  const allergensToAvoid = (preferences?.allergensToAvoid ?? []) as Allergen[]
  const excludedIngredientIds = preferences?.excludedIngredientIds ?? []

  try {
    // Get favorite meal IDs for this household
    const favoriteMealIds =
      source === 'favorites'
        ? (
            await prisma.favoriteMeal.findMany({
              where: { householdId: household.id },
              select: { mealId: true },
            })
          ).map((f) => f.mealId)
        : []

    // Build source filter
    const sourceFilter: Prisma.MealWhereInput =
      source === 'system'
        ? { householdId: null }
        : source === 'custom'
          ? { householdId: household.id }
          : source === 'favorites'
            ? { id: { in: favoriteMealIds } }
            : // 'all' or null: show system meals + this household's custom meals
              { OR: [{ householdId: null }, { householdId: household.id }] }

    // When search is provided, use fuzzy matching to get meal IDs
    // Searches both meal name AND ingredient names
    // Limited to FUZZY_SEARCH_CAP results to prevent loading too many into memory
    let fuzzyMealMatches: FuzzyMealMatch[] | null = null
    if (search) {
      fuzzyMealMatches = await prisma.$queryRaw<FuzzyMealMatch[]>`
        SELECT DISTINCT m.id,
          GREATEST(
            similarity(m.name, ${search}),
            word_similarity(${search}, m.name),
            COALESCE((
              SELECT MAX(GREATEST(
                similarity(i.name, ${search}),
                word_similarity(${search}, i.name)
              ))
              FROM "meal_component" mc
              JOIN "ingredient" i ON i.id = mc."ingredientId"
              WHERE mc."mealId" = m.id
            ), 0)
          ) as similarity
        FROM "meal" m
        WHERE (
          similarity(m.name, ${search}) >= ${SIMILARITY_THRESHOLD}
          OR word_similarity(${search}, m.name) >= ${SIMILARITY_THRESHOLD}
          OR EXISTS (
            SELECT 1 FROM "meal_component" mc
            JOIN "ingredient" i ON i.id = mc."ingredientId"
            WHERE mc."mealId" = m.id
            AND (
              similarity(i.name, ${search}) >= ${SIMILARITY_THRESHOLD}
              OR word_similarity(${search}, i.name) >= ${SIMILARITY_THRESHOLD}
            )
          )
        )
        ORDER BY similarity DESC
        LIMIT ${FUZZY_SEARCH_CAP}
      `
    }

    // Build where clause
    const where: Prisma.MealWhereInput = {
      AND: [
        // Only show non-deleted meals
        { deletedAt: null },
        // Source filter
        sourceFilter,
        // Filter by meal type if specified
        ...(mealType ? [{ suitableFor: { has: mealType } }] : []),
        // Filter by protein type if specified
        ...(proteinType ? [{ primaryProteinType: proteinType }] : []),
        // Filter by kid-friendly if specified
        ...(kidFriendly !== null ? [{ kidFriendly }] : []),
        // Fuzzy search filter: only include meals matching the search
        ...(fuzzyMealMatches ? [{ id: { in: fuzzyMealMatches.map((m) => m.id) } }] : []),
        // Hard filter: allergens - exclude meals with any allergen-containing ingredients
        ...(allergensToAvoid.length > 0
          ? [
              {
                NOT: {
                  components: {
                    some: {
                      ingredient: {
                        allergens: { hasSome: allergensToAvoid },
                      },
                    },
                  },
                },
              },
            ]
          : []),
        // Hard filter: excluded ingredients
        ...(excludedIngredientIds.length > 0
          ? [
              {
                NOT: {
                  components: {
                    some: { ingredientId: { in: excludedIngredientIds } },
                  },
                },
              },
            ]
          : []),
      ],
    }

    // Get total count for pagination
    const total = await prisma.meal.count({ where })

    // Build orderBy - use similarity ordering when searching, otherwise alphabetical
    const fuzzyOrderMap = fuzzyMealMatches
      ? new Map(fuzzyMealMatches.map((m) => [m.id, m.similarity]))
      : null

    // Fetch meals with pagination
    const mealsRaw = await prisma.meal.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        timeMinutes: true,
        kidFriendly: true,
        primaryProteinType: true,
        suitableFor: true,
        householdId: true,
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
                ...ingredientTranslationsInclude(household.locale),
              },
            },
          },
        },
        favoritedBy: {
          where: { householdId: household.id },
          select: { id: true },
        },
        ...mealTranslationsInclude(household.locale),
      },
      // When searching, we need to fetch all matching meals and sort in memory
      // because Prisma doesn't support ordering by a computed value from raw SQL
      ...(fuzzyOrderMap ? {} : { orderBy: { name: 'asc' } }),
      skip: fuzzyOrderMap ? 0 : offset,
      take: fuzzyOrderMap ? undefined : limit,
    })

    // Sort by similarity if searching, then apply pagination
    let sortedMeals = mealsRaw
    if (fuzzyOrderMap) {
      sortedMeals = [...mealsRaw].sort((a, b) => {
        const simA = fuzzyOrderMap.get(a.id) ?? 0
        const simB = fuzzyOrderMap.get(b.id) ?? 0
        return simB - simA // Descending similarity
      })
      sortedMeals = sortedMeals.slice(offset, offset + limit)
    }

    // Compute nutrition per serving for each meal and format components
    const meals = sortedMeals.map((meal) => {
      const nutrition = meal.components.reduce(
        (acc, comp) => {
          if (comp.isVague) return acc
          const factor = comp.quantityPerServing / 100
          return {
            calories: acc.calories + comp.ingredient.calories * factor,
            protein: acc.protein + comp.ingredient.protein * factor,
            carbs: acc.carbs + comp.ingredient.carbs * factor,
            fat: acc.fat + comp.ingredient.fat * factor,
          }
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      )

      const translatedMeal = translateMeal(meal, household.locale)

      // Format components for AlternativeCard compatibility
      const components = meal.components.map((comp) => {
        const translatedIngredient = translateIngredient(comp.ingredient, household.locale)
        return {
          ingredientId: comp.ingredientId,
          quantityPerServing: comp.quantityPerServing,
          ingredient: {
            id: translatedIngredient.id,
            name: translatedIngredient.name,
            category: translatedIngredient.category,
            defaultUnit: translatedIngredient.defaultUnit,
            gramsPerPiece: translatedIngredient.gramsPerPiece,
          },
        }
      })

      return {
        id: translatedMeal.id,
        name: translatedMeal.name,
        description: translatedMeal.description,
        timeMinutes: translatedMeal.timeMinutes,
        kidFriendly: translatedMeal.kidFriendly,
        primaryProteinType: translatedMeal.primaryProteinType,
        suitableFor: translatedMeal.suitableFor,
        isCustom: meal.householdId !== null,
        isFavorite: meal.favoritedBy.length > 0,
        components,
        nutrition: {
          calories: Math.round(nutrition.calories),
          protein: Math.round(nutrition.protein),
          carbs: Math.round(nutrition.carbs),
          fat: Math.round(nutrition.fat),
        },
      }
    })

    return NextResponse.json({
      meals,
      total,
      hasMore: offset + meals.length < total,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/meals', householdId: household.id })
    return NextResponse.json({ error: 'Failed to fetch meals' }, { status: 500 })
  }
}
