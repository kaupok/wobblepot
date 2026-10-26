import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { searchIngredients } from '@/lib/ingredients/search'
import { createHouseholdIngredient } from '@/lib/ingredients/create'
import { ingredientRateLimited, parseIngredientBody } from './request'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search')?.trim() || ''
  const category = searchParams.get('category') as IngredientCategory | null
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  )

  // Empty search returns empty array (not all ingredients)
  if (!search) {
    return NextResponse.json({ ingredients: [] })
  }

  try {
    // A user with no household still searches, the global ingredients only.
    const membership = await getHouseholdMembership(session.user.id)

    const ingredients = await searchIngredients({
      search,
      category,
      limit,
      householdId: membership?.householdId ?? null,
      // Match and return the name the household sees on screen, not only the
      // English one (HON-911). The household's locale, never Accept-Language.
      locale: resolveHouseholdLocale(membership?.household),
    })

    return NextResponse.json({ ingredients })
  } catch (error) {
    captureApiError(error, { route: '/api/ingredients', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to search ingredients' }, { status: 500 })
  }
}

/**
 * POST /api/ingredients
 *
 * "Add as new ingredient" from an unmatched ingredient row (HON-1263): a
 * household-scoped ingredient, or the existing one the name already means.
 * Error strings are English, for logs; the form branches on the status.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Unlike the search, a new ingredient belongs to a household.
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 403 })
  }

  const parsed = await parseIngredientBody(request)
  if ('response' in parsed) return parsed.response

  const { household } = membership

  try {
    const limited = await ingredientRateLimited(household.id)
    if (limited) return limited

    const ingredient = await createHouseholdIngredient(
      household.id,
      resolveHouseholdLocale(household),
      parsed.data,
    )
    return NextResponse.json({ ingredient }, { status: 201 })
  } catch (error) {
    captureApiError(error, { route: '/api/ingredients', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to create ingredient' }, { status: 500 })
  }
}
