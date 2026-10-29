import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { addFavorite, FavoriteError, removeFavorite } from '@/lib/meals/favorite'

const REFUSALS = {
  mealNotFound: { error: 'Meal not found', status: 404 },
  alreadyFavorite: { error: 'Meal is already favorited', status: 409 },
  notFavorite: { error: 'Favorite not found', status: 404 },
} as const

const refuse = (error: FavoriteError) => {
  const { error: message, status } = REFUSALS[error.reason]
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: mealId } = await params

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

    const favorite = await addFavorite(membership.household.id, mealId)

    return NextResponse.json({ id: favorite.id, mealId, isFavorite: true }, { status: 201 })
  } catch (error) {
    if (error instanceof FavoriteError) return refuse(error)
    captureApiError(error, { route: '/api/meals/[id]/favorite', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to favorite meal' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: mealId } = await params

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

    await removeFavorite(membership.household.id, mealId)

    return NextResponse.json({ mealId, isFavorite: false })
  } catch (error) {
    if (error instanceof FavoriteError) return refuse(error)
    captureApiError(error, { route: '/api/meals/[id]/favorite', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to unfavorite meal' }, { status: 500 })
  }
}
