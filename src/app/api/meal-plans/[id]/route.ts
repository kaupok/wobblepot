import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { toDateString } from '@/lib/meal-planning/dates'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // Extract plan ID from params
  const { id } = await params

  try {
    // Query meal plan with nested relations
    const plan = await prisma.mealPlan.findUnique({
      where: { id },
      include: {
        entries: {
          include: {
            meal: {
              include: {
                components: {
                  include: {
                    ingredient: {
                      include: ingredientTranslationsInclude(household.locale),
                    },
                  },
                },
                ...mealTranslationsInclude(household.locale),
              },
            },
          },
          orderBy: { date: 'asc' },
        },
      },
    })

    // Return 404 if plan not found
    if (!plan) {
      return NextResponse.json({ error: 'Meal plan not found' }, { status: 404 })
    }

    // Return 403 if plan belongs to different household
    if (plan.householdId !== household.id) {
      return NextResponse.json({ error: 'Access denied to this meal plan' }, { status: 403 })
    }

    // Format response
    const response = {
      id: plan.id,
      entries: plan.entries.map((entry) => ({
        id: entry.id,
        date: toDateString(entry.date),
        mealType: entry.mealType as 'dinner', // Cast needed: GeneratePlanResult expects literal 'dinner', not MealType enum
        status: entry.status,
        servingOverride: entry.servingOverride,
        meal: entry.meal
          ? (() => {
              const translatedMeal = translateMeal(entry.meal, household.locale)
              return {
                id: translatedMeal.id,
                name: translatedMeal.name,
                kidFriendly: translatedMeal.kidFriendly,
                timeMinutes: translatedMeal.timeMinutes,
                preparationNotes: translatedMeal.preparationNotes,
                primaryProteinType: translatedMeal.primaryProteinType,
                nutrition: computeMealNutrition(entry.meal.components),
                components: entry.meal.components.map((comp) => {
                  const translatedIngredient = translateIngredient(
                    comp.ingredient,
                    household.locale,
                  )
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
              }
            })()
          : null,
      })),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('Failed to fetch meal plan:', error)
    return NextResponse.json({ error: 'Failed to fetch meal plan' }, { status: 500 })
  }
}
