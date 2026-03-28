import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { toDateString, parseLocalDate } from '@/lib/meal-planning/dates'
import { parseStoredTips } from '@/lib/tips'
import type { MealPlanEntryStatus } from '@/generated/prisma/enums'

/**
 * GET /api/entries?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=planned
 *
 * Query entries by arbitrary date range for the authenticated user's household.
 * Returns entries from the household's single plan within the date range.
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // Parse query params
  const startDateParam = request.nextUrl.searchParams.get('startDate')
  const endDateParam = request.nextUrl.searchParams.get('endDate')
  const statusParam = request.nextUrl.searchParams.get('status')

  if (!startDateParam || !endDateParam) {
    return NextResponse.json(
      { error: 'startDate and endDate query params are required (YYYY-MM-DD)' },
      { status: 400 },
    )
  }

  let startDate: Date
  let endDate: Date
  try {
    startDate = parseLocalDate(startDateParam)
    endDate = parseLocalDate(endDateParam)
  } catch {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 })
  }

  try {
    // Find the household's single plan
    const plan = await prisma.mealPlan.findUnique({
      where: { householdId: household.id },
    })

    // No plan yet — new household, return empty
    if (!plan) {
      return NextResponse.json({ entries: [], planId: null }, { status: 200 })
    }

    // Build where clause for entries
    const where: {
      planId: string
      date: { gte: Date; lt: Date }
      status?: MealPlanEntryStatus
    } = {
      planId: plan.id,
      date: { gte: startDate, lt: endDate },
    }

    if (statusParam) {
      const validStatuses: string[] = ['planned', 'completed', 'skipped']
      if (!validStatuses.includes(statusParam)) {
        return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
      }
      where.status = statusParam as MealPlanEntryStatus
    }

    const entries = await prisma.mealPlanEntry.findMany({
      where,
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
      orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
    })

    const formattedEntries = entries.map((entry) => ({
      id: entry.id,
      date: toDateString(entry.date),
      mealType: entry.mealType,
      status: entry.status,
      rating: entry.rating,
      preparationTips: entry.preparationTips ? parseStoredTips(entry.preparationTips) : null,
      note: entry.note,
      servingOverride: entry.servingOverride,
      meal: entry.meal
        ? {
            id: entry.meal.id,
            name: entry.meal.name,
            kidFriendly: entry.meal.kidFriendly,
            timeMinutes: entry.meal.timeMinutes,
            preparationNotes: entry.meal.preparationNotes,
            primaryProteinType: entry.meal.primaryProteinType,
            nutrition: computeMealNutrition(entry.meal.components),
            components: entry.meal.components.map((comp) => ({
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
          }
        : null,
    }))

    return NextResponse.json({ entries: formattedEntries, planId: plan.id }, { status: 200 })
  } catch (error) {
    console.error('Failed to fetch entries:', error)
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 })
  }
}
