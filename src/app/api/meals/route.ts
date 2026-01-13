import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import type { Allergen, MealType, ProteinType } from '@/generated/prisma/enums'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

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
    // Build where clause
    const where: Prisma.MealWhereInput = {
      AND: [
        // Filter by meal type if specified
        ...(mealType ? [{ suitableFor: { has: mealType } }] : []),
        // Filter by protein type if specified
        ...(proteinType ? [{ primaryProteinType: proteinType }] : []),
        // Filter by kid-friendly if specified
        ...(kidFriendly !== null ? [{ kidFriendly }] : []),
        // Search by name (case-insensitive)
        ...(search ? [{ name: { contains: search, mode: 'insensitive' as const } }] : []),
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

    // Fetch meals with pagination
    const meals = await prisma.meal.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        timeMinutes: true,
        kidFriendly: true,
        primaryProteinType: true,
      },
      orderBy: { name: 'asc' },
      skip: offset,
      take: limit,
    })

    return NextResponse.json({
      meals,
      total,
      hasMore: offset + meals.length < total,
    })
  } catch (error) {
    console.error('Failed to fetch meals:', error)
    return NextResponse.json({ error: 'Failed to fetch meals' }, { status: 500 })
  }
}
