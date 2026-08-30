import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { getHouseholdMembership } from '@/lib/household'
import { deriveProteinType } from '@/lib/meal-planning/protein'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { captureApiError } from '@/lib/errors'

const createMealSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullish(),
  preparationNotes: z.string().max(5000).nullish(),
  sourceUrl: z
    .string()
    .url()
    .max(2000)
    .refine((url) => /^https?:\/\//i.test(url), 'Only http/https URLs are allowed')
    .nullish(),
  timeMinutes: z.number().int().positive().max(480).nullish(),
  kidFriendly: z.boolean().optional().default(false),
  suitableFor: z.array(z.enum(['breakfast', 'lunch', 'dinner'])).min(1),
  servings: z.number().int().positive().max(50),
  components: z
    .array(
      z
        .object({
          ingredientId: z.string().min(1),
          totalQuantity: z.number().nonnegative(),
          isVague: z.boolean().optional().default(false),
          originalPhrase: z.string().nullish(),
        })
        .refine((c) => c.isVague || c.totalQuantity > 0, {
          message: 'Quantity must be greater than 0 for non-vague components',
        })
        .transform((c) => ({
          ...c,
          totalQuantity: c.isVague ? 0 : c.totalQuantity,
        })),
    )
    .min(1),
})

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search')?.trim() || null
    const includeDeleted = searchParams.get('includeDeleted') === 'true'
    const cursor = searchParams.get('cursor') || null

    const limitParam = searchParams.get('limit')
    const limitResult = z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .safeParse(limitParam ?? 30)
    if (!limitResult.success) {
      return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
    }
    const limit = limitResult.data

    const householdLocale = membership.household.locale
    const baseQuery = {
      where: {
        householdId: membership.household.id,
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
                ...ingredientTranslationsInclude(householdLocale),
              },
            },
          },
        },
        favoritedBy: {
          where: { householdId: membership.household.id },
          select: { id: true },
        },
        ...mealTranslationsInclude(householdLocale),
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
      if (
        cursor &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        meals = await prisma.meal.findMany(baseQuery)
      } else {
        throw error
      }
    }

    const hasNext = meals.length > limit
    const pageMeals = hasNext ? meals.slice(0, limit) : meals
    const nextCursor = hasNext ? (pageMeals.at(-1)?.id ?? null) : null

    const mealsWithNutrition = pageMeals.map((meal) => {
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

      const allergens = [...new Set(meal.components.flatMap((comp) => comp.ingredient.allergens))]
      const translatedMeal = translateMeal(meal, householdLocale)

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
        deletedAt: meal.deletedAt,
        createdAt: meal.createdAt,
        updatedAt: meal.updatedAt,
        components: meal.components.map((comp) => {
          const translatedIngredient = translateIngredient(comp.ingredient, householdLocale)
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

    return NextResponse.json({ meals: mealsWithNutrition, nextCursor })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/meals', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch meals' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = createMealSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const {
      name,
      description,
      preparationNotes,
      sourceUrl,
      timeMinutes,
      kidFriendly,
      suitableFor,
      servings,
      components,
    } = parsed.data

    // Verify all ingredients exist and fetch their protein types
    const ingredientIds = components.map((c) => c.ingredientId)
    const ingredients = await prisma.ingredient.findMany({
      where: { id: { in: ingredientIds } },
      select: {
        id: true,
        proteinType: true,
        protein: true,
      },
    })

    if (ingredients.length !== ingredientIds.length) {
      const foundIds = new Set(ingredients.map((i) => i.id))
      const missingIds = ingredientIds.filter((id) => !foundIds.has(id))
      return NextResponse.json({ error: 'Some ingredients not found', missingIds }, { status: 400 })
    }

    // Derive primary protein type from ingredients
    const ingredientMap = new Map(ingredients.map((i) => [i.id, i]))
    const componentData = components.map((c) => ({
      quantityPerServing: c.totalQuantity / servings,
      ingredient: ingredientMap.get(c.ingredientId)!,
    }))
    const primaryProteinType = deriveProteinType(componentData)

    // Create meal with components
    const meal = await prisma.meal.create({
      data: {
        name,
        description,
        preparationNotes,
        sourceUrl,
        timeMinutes,
        kidFriendly,
        suitableFor,
        servings,
        primaryProteinType,
        householdId: membership.household.id,
        components: {
          create: components.map((c) => ({
            ingredientId: c.ingredientId,
            quantityPerServing: c.totalQuantity / servings,
            isVague: c.isVague ?? false,
            originalPhrase: c.originalPhrase ?? null,
          })),
        },
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
              },
            },
          },
        },
      },
    })

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

    const allergens = [...new Set(meal.components.flatMap((comp) => comp.ingredient.allergens))]

    return NextResponse.json(
      {
        id: meal.id,
        name: meal.name,
        description: meal.description,
        preparationNotes: meal.preparationNotes,
        sourceUrl: meal.sourceUrl,
        timeMinutes: meal.timeMinutes,
        kidFriendly: meal.kidFriendly,
        primaryProteinType: meal.primaryProteinType,
        suitableFor: meal.suitableFor,
        servings: meal.servings,
        isCustom: true,
        isFavorite: false,
        createdAt: meal.createdAt,
        updatedAt: meal.updatedAt,
        components: meal.components.map((comp) => ({
          ingredientId: comp.ingredientId,
          quantityPerServing: comp.quantityPerServing,
          isVague: comp.isVague,
          originalPhrase: comp.originalPhrase,
          ingredient: {
            id: comp.ingredient.id,
            name: comp.ingredient.name,
            category: comp.ingredient.category,
            defaultUnit: comp.ingredient.defaultUnit,
            gramsPerPiece: comp.ingredient.gramsPerPiece,
          },
        })),
        nutrition: {
          calories: Math.round(nutrition.calories),
          protein: Math.round(nutrition.protein),
          carbs: Math.round(nutrition.carbs),
          fat: Math.round(nutrition.fat),
        },
        allergens,
      },
      { status: 201 },
    )
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/meals', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to create meal' }, { status: 500 })
  }
}
