import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import {
  customItemUpdateSchema,
  deleteCustomShoppingItem,
  updateCustomShoppingItem,
} from '@/lib/shopping/custom-items'

/**
 * PATCH /api/shopping-list/custom/[id]
 *
 * Update a custom shopping item: toggle checked or update ingredient link.
 * When checking a linked item, also creates/touches a pantry item.
 * The `check_shopping_item` MCP tool calls the same `updateCustomShoppingItem`.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const { household } = membership
    const { id } = await params

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = customItemUpdateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const outcome = await updateCustomShoppingItem(household.id, id, parsed.data)

    switch (outcome.status) {
      case 'not_found':
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      case 'ingredient_not_found':
        return NextResponse.json({ error: 'Ingredient not found' }, { status: 400 })
      case 'updated':
        return NextResponse.json({ item: outcome.item }, { status: 200 })
    }
  } catch (error) {
    captureApiError(error, {
      route: '/api/shopping-list/custom/[id]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
}

/**
 * DELETE /api/shopping-list/custom/[id]
 *
 * Remove a single custom shopping item.
 */
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

    const { household } = membership
    const { id } = await params

    if (!(await deleteCustomShoppingItem(household.id, id))) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/shopping-list/custom/[id]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
