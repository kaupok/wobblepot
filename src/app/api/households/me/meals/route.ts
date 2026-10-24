import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import {
  createHouseholdMeal,
  HOUSEHOLD_MEALS_DEFAULT_LIMIT,
  HouseholdMealError,
  listHouseholdMeals,
} from '@/lib/household-meals'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { captureApiError } from '@/lib/errors'
import { duplicateComponentIds, mealComponentsSchema } from '@/lib/meal-planning/components-schema'
import { mealFieldsSchema } from '@/lib/meals/meal-fields-schema'

const createMealSchema = mealFieldsSchema.extend({ components: mealComponentsSchema })

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
      .safeParse(limitParam ?? HOUSEHOLD_MEALS_DEFAULT_LIMIT)
    if (!limitResult.success) {
      return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
    }
    const limit = limitResult.data

    const page = await listHouseholdMeals({
      householdId: membership.household.id,
      locale: resolveHouseholdLocale(membership.household),
      search,
      cursor,
      limit,
      includeDeleted,
    })

    return NextResponse.json(page)
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
      const duplicateIds = duplicateComponentIds(parsed.error)
      if (duplicateIds) {
        return NextResponse.json(
          { error: 'Duplicate ingredients in components', duplicateIds },
          { status: 400 },
        )
      }

      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const meal = await createHouseholdMeal(membership.household.id, parsed.data)

    return NextResponse.json(meal, { status: 201 })
  } catch (error) {
    if (error instanceof HouseholdMealError && error.reason === 'ingredientsNotFound') {
      return NextResponse.json(
        { error: 'Some ingredients not found', missingIds: error.missingIds },
        { status: 400 },
      )
    }

    captureApiError(error, { route: '/api/households/me/meals', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to create recipe' }, { status: 500 })
  }
}
