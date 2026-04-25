import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { parseStoredTips } from '@/lib/tips'
import { captureApiError } from '@/lib/errors'
import {
  toDateString,
  getCurrentWeekMonday,
  getLastWeekMonday,
  getNextMonday,
  isSunday,
  getDaysRemaining,
} from '@/lib/meal-planning/dates'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'

function buildEntryInclude(locale: string) {
  return {
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
  } as const
}

export async function GET(request: NextRequest) {
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

  // Parse week query param: 'last' | 'current' | 'next' (defaults to 'current')
  const weekParam = request.nextUrl.searchParams.get('week')
  const targetWeek = weekParam === 'next' ? 'next' : weekParam === 'last' ? 'last' : 'current'

  try {
    // Find the household's single plan
    const plan = await prisma.mealPlan.findUnique({
      where: { householdId: household.id },
    })

    // Compute Monday boundaries from week param
    let monday: Date
    let weekType: 'last' | 'current' | 'next' = targetWeek

    if (targetWeek === 'last') {
      monday = getLastWeekMonday()
    } else if (targetWeek === 'next') {
      monday = getNextMonday()
    } else {
      monday = getCurrentWeekMonday()
    }

    const endDate = new Date(monday)
    endDate.setDate(monday.getDate() + 7)

    // If no plan exists, return 404 with context
    if (!plan) {
      const daysRemaining = getDaysRemaining(household.timezone)
      return NextResponse.json(
        {
          error: 'No active meal plan',
          weekContext: {
            type: weekType,
            daysRemaining,
            isSunday: isSunday(),
          },
        },
        { status: 404 },
      )
    }

    // Query entries in the computed date range
    const entries = await prisma.mealPlanEntry.findMany({
      where: {
        planId: plan.id,
        date: { gte: monday, lt: endDate },
      },
      include: buildEntryInclude(household.locale),
      orderBy: { date: 'asc' },
    })

    // For "current" week with no entries: try Sunday fallback to next week
    if (entries.length === 0 && targetWeek === 'current' && isSunday()) {
      const nextMonday = getNextMonday()
      const nextEndDate = new Date(nextMonday)
      nextEndDate.setDate(nextMonday.getDate() + 7)

      const nextEntries = await prisma.mealPlanEntry.findMany({
        where: {
          planId: plan.id,
          date: { gte: nextMonday, lt: nextEndDate },
        },
        include: buildEntryInclude(household.locale),
        orderBy: { date: 'asc' },
      })

      if (nextEntries.length > 0) {
        // Use next week instead
        monday = nextMonday
        endDate.setTime(nextEndDate.getTime())
        weekType = 'next'
        entries.length = 0
        entries.push(...nextEntries)
      }
    }

    // No entries for this week — return 404 with context
    if (entries.length === 0) {
      const daysRemaining = getDaysRemaining(household.timezone)
      return NextResponse.json(
        {
          error: 'No active meal plan',
          weekContext: {
            type: weekType,
            daysRemaining,
            isSunday: isSunday(),
          },
        },
        { status: 404 },
      )
    }

    // Calculate week context
    const daysCount = weekType === 'current' ? getDaysRemaining(household.timezone) : 7
    const isPartialWeek = daysCount < 7

    // Synthesize the old response shape with computed dates
    const response = {
      id: plan.id,
      startDate: toDateString(monday),
      endDate: toDateString(endDate),
      entries: entries.map((entry) => ({
        id: entry.id,
        date: toDateString(entry.date),
        mealType: entry.mealType as 'dinner',
        status: entry.status,
        rating: entry.rating,
        preparationTips: entry.preparationTips ? parseStoredTips(entry.preparationTips) : null,
        note: entry.note,
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
      weekContext: {
        type: weekType,
        daysCount,
        isPartialWeek,
      },
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    captureApiError(error, { route: '/api/meal-plans/current', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch current meal plan' }, { status: 500 })
  }
}
