import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { createDayExtra } from '@/lib/day-extras/day-extras'
import { createDayExtraSchema } from '@/lib/day-extras/schemas'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'

/** Adds an extra to a day (HON-1309): `{ date, ingredientId, quantity? }` or `{ date, label }`. */
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

    const parsed = createDayExtraSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const outcome = await createDayExtra(membership.household, parsed.data)

    if (outcome.status === 'past_date') {
      return NextResponse.json(
        { error: 'Cannot add an extra to a past day', code: 'past_date' },
        { status: 400 },
      )
    }
    if (outcome.status === 'ingredient_not_found') {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    return NextResponse.json(outcome.extra, { status: 201 })
  } catch (error) {
    captureApiError(error, { route: '/api/extras', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to add extra' }, { status: 500 })
  }
}
