import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { deleteDayExtra, updateDayExtraQuantity } from '@/lib/day-extras/day-extras'
import { updateDayExtraSchema } from '@/lib/day-extras/schemas'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'

/** Sets an ingredient extra's amount (HON-1309): `{ quantity }`, null for no amount. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const parsed = updateDayExtraSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const { id } = await params

    const outcome = await updateDayExtraQuantity(membership.household, id, parsed.data.quantity)

    if (outcome.status === 'not_found') {
      return NextResponse.json({ error: 'Extra not found' }, { status: 404 })
    }
    if (outcome.status === 'free_text') {
      return NextResponse.json({ error: 'A free-text extra has no amount' }, { status: 400 })
    }

    return NextResponse.json(outcome.extra)
  } catch (error) {
    captureApiError(error, { route: '/api/extras/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update extra' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const { id } = await params

    const outcome = await deleteDayExtra(membership.householdId, id)

    if (outcome.status === 'not_found') {
      return NextResponse.json({ error: 'Extra not found' }, { status: 404 })
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, { route: '/api/extras/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete extra' }, { status: 500 })
  }
}
