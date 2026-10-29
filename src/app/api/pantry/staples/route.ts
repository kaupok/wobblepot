import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { listPantryStaples } from '@/lib/pantry/staple-ran-out'

/**
 * GET /api/pantry/staples
 *
 * The household's staples, with the name in the household's language and in
 * English, for the shopping list's "Add item" dropdown (HON-1400).
 */
export async function GET() {
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

  try {
    return NextResponse.json({ staples: await listPantryStaples(membership.household) })
  } catch (error) {
    captureApiError(error, { route: '/api/pantry/staples', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch staples' }, { status: 500 })
  }
}
