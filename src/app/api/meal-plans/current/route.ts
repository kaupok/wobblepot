import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import {
  toDateString,
  getCurrentWeekMonday,
  getNextMonday,
  isSunday,
  getDaysRemaining,
} from '@/lib/meal-planning/dates'

// Common include pattern for meal plan queries
const mealPlanInclude = {
  entries: {
    include: {
      meal: {
        include: {
          components: {
            include: {
              ingredient: true,
            },
          },
        },
      },
    },
    orderBy: { date: 'asc' } as const,
  },
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

  // Parse week query param: 'current' | 'next' (defaults to 'current')
  const weekParam = request.nextUrl.searchParams.get('week')
  const targetWeek = weekParam === 'next' ? 'next' : 'current'

  try {
    // Get today's date normalized to midnight
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let plan
    let weekType: 'current' | 'next'

    if (targetWeek === 'next') {
      // Explicitly requesting next week's plan
      const nextMonday = getNextMonday()
      plan = await prisma.mealPlan.findFirst({
        where: {
          householdId: household.id,
          startDate: nextMonday,
        },
        include: mealPlanInclude,
      })
      weekType = 'next'
    } else {
      // Current week: find plan containing today
      const currentMonday = getCurrentWeekMonday()
      plan = await prisma.mealPlan.findFirst({
        where: {
          householdId: household.id,
          startDate: currentMonday,
        },
        include: mealPlanInclude,
      })
      weekType = 'current'

      // Fallback for Sunday or when no current week plan:
      // Return next week's plan if it exists
      if (!plan && isSunday()) {
        const nextMonday = getNextMonday()
        plan = await prisma.mealPlan.findFirst({
          where: {
            householdId: household.id,
            startDate: nextMonday,
          },
          include: mealPlanInclude,
        })
        weekType = 'next'
      }
    }

    // Return 404 if no plan found
    if (!plan) {
      // Return context even on 404 so the UI knows what week to generate
      const daysRemaining = getDaysRemaining()
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
    const daysCount = plan.entries.length
    const isPartialWeek = daysCount < 7

    // Format response to match GeneratePlanResult type
    const response = {
      id: plan.id,
      startDate: toDateString(plan.startDate),
      endDate: toDateString(plan.endDate),
      entries: plan.entries.map((entry) => ({
        id: entry.id,
        date: toDateString(entry.date),
        mealType: entry.mealType as 'dinner', // Cast needed: GeneratePlanResult expects literal 'dinner', not MealType enum
        status: entry.status,
        meal: entry.meal
          ? {
              id: entry.meal.id,
              name: entry.meal.name,
              kidFriendly: entry.meal.kidFriendly,
              timeMinutes: entry.meal.timeMinutes,
              primaryProteinType: entry.meal.primaryProteinType,
              nutrition: computeMealNutrition(entry.meal.components),
              components: entry.meal.components.map((comp) => ({
                quantityPerServing: comp.quantityPerServing,
                ingredient: {
                  name: comp.ingredient.name,
                  category: comp.ingredient.category,
                  defaultUnit: comp.ingredient.defaultUnit,
                  gramsPerPiece: comp.ingredient.gramsPerPiece,
                },
              })),
            }
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
    console.error('Failed to fetch current meal plan:', error)
    return NextResponse.json({ error: 'Failed to fetch current meal plan' }, { status: 500 })
  }
}
