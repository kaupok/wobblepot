import { headers } from 'next/headers'
import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { createHouseholdMeal, HouseholdMealError } from '@/lib/household-meals'
import { HOUSEHOLD_MEALS_DEFAULT_LIMIT, listHouseholdMeals } from '@/lib/household-meals-read'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { claimSavedMealImage, drawSavedMealImage } from '@/lib/meal-images/start'
import { duplicateComponentIds, mealComponentsSchema } from '@/lib/meal-planning/components-schema'
import { getTodayInTimezone } from '@/lib/meal-planning/dates'
import { mealFieldsSchema, proteinTypeOverrideSchema } from '@/lib/meals/meal-fields-schema'

const ROUTE = '/api/households/me/meals'

// `proteinTypeOverride` is the app's only: `create_meal` shares
// `mealFieldsSchema` and gains it in HON-1387.
const createMealSchema = mealFieldsSchema.extend({
  components: mealComponentsSchema,
  proteinTypeOverride: proteinTypeOverrideSchema.optional(),
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
      .safeParse(limitParam ?? HOUSEHOLD_MEALS_DEFAULT_LIMIT)
    if (!limitResult.success) {
      return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
    }
    const limit = limitResult.data

    const page = await listHouseholdMeals({
      householdId: membership.household.id,
      locale: resolveHouseholdLocale(membership.household),
      today: getTodayInTimezone(membership.household.timezone),
      search,
      cursor,
      limit,
      includeDeleted,
    })

    return NextResponse.json(page)
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
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

    const householdId = membership.household.id
    const meal = await createHouseholdMeal(householdId, parsed.data)

    // A saved recipe is one the household means to cook, so its image starts
    // now rather than on the first cook view (HON-1364). The claim is taken
    // here, so the list read after the save shows it drawing; the draw itself
    // runs after the response, so saving is not slower.
    const imageClaim = await claimSavedMealImage(householdId, meal.id, ROUTE)
    if (imageClaim) {
      const userId = session.user.id
      after(() => drawSavedMealImage(imageClaim, { householdId, userId, route: ROUTE }))
    }

    return NextResponse.json(meal, { status: 201 })
  } catch (error) {
    if (error instanceof HouseholdMealError && error.reason === 'ingredientsNotFound') {
      return NextResponse.json(
        { error: 'Some ingredients not found', missingIds: error.missingIds },
        { status: 400 },
      )
    }
    if (error instanceof HouseholdMealError && error.reason === 'proteinTypeNotInRecipe') {
      return NextResponse.json(
        { error: 'No ingredient carries that protein', code: 'proteinTypeNotInRecipe' },
        { status: 400 },
      )
    }

    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to create recipe' }, { status: 500 })
  }
}

/**
 * Platform execution ceiling for this route, in seconds. `after()` runs within
 * it, and the image drawn after a save needs up to 50 s of AI time
 * (`@/lib/meal-images/start`); 60 is the value every Vercel plan allows.
 */
export const maxDuration = 60
