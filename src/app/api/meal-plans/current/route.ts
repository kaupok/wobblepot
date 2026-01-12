import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { toDateString } from '@/lib/meal-planning/dates'

export async function GET() {
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

  try {
    // Get today's date normalized to midnight
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Query meal plan containing today's date
    const plan = await prisma.mealPlan.findFirst({
      where: {
        householdId: household.id,
        startDate: { lte: today },
        endDate: { gt: today },
      },
      include: {
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
          orderBy: { date: 'asc' },
        },
      },
      orderBy: { startDate: 'desc' },
    })

    // Return 404 if no current plan found
    if (!plan) {
      return NextResponse.json({ error: 'No active meal plan' }, { status: 404 })
    }

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
            }
          : null,
      })),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('Failed to fetch current meal plan:', error)
    return NextResponse.json({ error: 'Failed to fetch current meal plan' }, { status: 500 })
  }
}
