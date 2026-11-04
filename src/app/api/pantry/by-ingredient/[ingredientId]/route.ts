import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import {
  deletePantryItemByIngredient,
  updatePantryItemByIngredient,
} from '@/lib/pantry/pantry-items'

// The cook view's staple row (HON-1599): unticking marks the staple ran out
// (0), ticking sets it back to have some (null). Either keeps its star, which
// a DELETE would drop.
const updateByIngredientSchema = z.object({ quantity: z.union([z.literal(0), z.null()]) })

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ingredientId: string }> },
) {
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

    const parsed = updateByIngredientSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const { ingredientId } = await params

    const outcome = await updatePantryItemByIngredient(
      membership.household,
      ingredientId,
      parsed.data,
    )

    if (outcome.status === 'not_found') {
      return NextResponse.json({ error: 'Pantry item not found' }, { status: 404 })
    }

    const { item } = outcome
    return NextResponse.json({ id: item.id, quantity: item.quantity, isStaple: item.isStaple })
  } catch (error) {
    captureApiError(error, {
      route: '/api/pantry/by-ingredient/[ingredientId]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to update pantry item' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ ingredientId: string }> },
) {
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

    const { ingredientId } = await params

    const outcome = await deletePantryItemByIngredient(membership.householdId, ingredientId)

    if (outcome.status === 'not_found') {
      return NextResponse.json({ error: 'Pantry item not found' }, { status: 404 })
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/pantry/by-ingredient/[ingredientId]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to delete pantry item' }, { status: 500 })
  }
}
