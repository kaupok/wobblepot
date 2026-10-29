import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { deletePantryItem, pantryQuantitySchema, updatePantryItem } from '@/lib/pantry/pantry-items'

// The quantity rule (`>= 0` or `null`) is `pantryQuantitySchema`'s.
//
// The refine rejects a body with no updatable field — `{}`, or one carrying only
// unknown keys, which Zod strips to `{}`. Prisma would still issue that UPDATE
// and bump `@updatedAt`, and both shopping-list routes read a null quantity
// with `updatedAt >= plan createdAt` as "purchased" (HON-642). Presence is
// `!== undefined`, not truthiness: `quantity: null`, `0` and `isStaple: false`
// are all real updates.
const updatePantryItemSchema = z
  .object({
    quantity: pantryQuantitySchema.optional(),
    isStaple: z.boolean().optional(),
  })
  .refine((data) => data.quantity !== undefined || data.isStaple !== undefined, {
    message: 'At least one of quantity or isStaple must be provided',
  })

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

    const parsed = updatePantryItemSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const { id } = await params

    const outcome = await updatePantryItem(membership.household, id, parsed.data)

    if (outcome.status === 'not_found') {
      return NextResponse.json({ error: 'Pantry item not found' }, { status: 404 })
    }

    const { item } = outcome
    return NextResponse.json({
      id: item.id,
      ingredient: {
        id: item.ingredient.id,
        name: item.ingredient.name,
        category: item.ingredient.category,
        defaultUnit: item.ingredient.defaultUnit,
      },
      quantity: item.quantity,
      isStaple: item.isStaple,
      updatedAt: item.updatedAt,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/pantry/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update pantry item' }, { status: 500 })
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

    const outcome = await deletePantryItem(membership.householdId, id)

    if (outcome.status === 'not_found') {
      return NextResponse.json({ error: 'Pantry item not found' }, { status: 404 })
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, { route: '/api/pantry/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete pantry item' }, { status: 500 })
  }
}
