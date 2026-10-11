import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import type { MealType, ProteinType } from '@/generated/prisma/enums'
import { captureApiError } from '@/lib/errors'
import { loadMeals, MEALS_DEFAULT_LIMIT, type MealSource } from '@/lib/meals/load-meals'

/**
 * GET /api/meals: one page of the meals the household can plan. The query
 * lives in `loadMeals`, which the MCP `list_meals` tool shares (HON-1151).
 */
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
  const kidFriendlyParam = searchParams.get('kidFriendly')

  try {
    const result = await loadMeals(household, {
      mealType: searchParams.get('mealType') as MealType | null,
      proteinType: searchParams.get('proteinType') as ProteinType | null,
      kidFriendly: kidFriendlyParam === 'true' ? true : kidFriendlyParam === 'false' ? false : null,
      search: searchParams.get('search'),
      source: searchParams.get('source') as MealSource | null,
      limit:
        parseInt(searchParams.get('limit') || String(MEALS_DEFAULT_LIMIT), 10) ||
        MEALS_DEFAULT_LIMIT,
      offset: parseInt(searchParams.get('offset') || '0', 10) || 0,
    })
    return NextResponse.json(result)
  } catch (error) {
    captureApiError(error, {
      route: '/api/meals',
      userId: session.user.id,
      householdId: household.id,
    })
    return NextResponse.json({ error: 'Failed to fetch meals' }, { status: 500 })
  }
}
