import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { toDateString } from '@/lib/meal-planning/dates'

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
                    ingredient: true,
                  },
                },
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
              primaryProteinType: entry.meal.primaryProteinType,
              nutrition: computeMealNutrition(entry.meal.components),
            }
          : null,
      })),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('Failed to fetch meal plan:', error)
    return NextResponse.json({ error: 'Failed to fetch meal plan' }, { status: 500 })
  }
}
