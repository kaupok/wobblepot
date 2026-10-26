import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { listHouseholdIngredients } from '@/lib/ingredients/manage'

/**
 * GET /api/households/me/ingredients
 *
 * The ingredients the household added, for the Ingredients tab (HON-1264).
 * No global row.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 403 })
  }

  try {
    return NextResponse.json({
      ingredients: await listHouseholdIngredients(membership.householdId),
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/ingredients', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to load ingredients' }, { status: 500 })
  }
}
