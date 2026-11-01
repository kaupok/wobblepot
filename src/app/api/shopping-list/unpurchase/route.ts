import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import {
  ingredientIdSchema,
  restoreQuantitySchema,
  UNPURCHASE_WINDOW_DAYS,
  unpurchaseIngredient,
} from '@/lib/shopping/purchase'

const unpurchaseSchema = z.object({
  ingredientId: ingredientIdSchema,
  restoreQuantity: restoreQuantitySchema.optional(),
  // The `replacedLow` a purchase returned (HON-1586).
  restoreLow: z.boolean().optional(),
})

/**
 * POST /api/shopping-list/unpurchase
 *
 * Mark a shopping list item as unpurchased by removing from pantry.
 * Only works for non-staple items added within the last 7 days.
 * With `restoreQuantity`, the pantry item stays at that quantity instead, and
 * with `restoreLow` it stays, running low again (HON-1586).
 * Works with the rolling window shopping list (not tied to a specific plan).
 * The `mark_purchased` MCP tool calls the same `unpurchaseIngredient`.
 */
export async function POST(request: Request) {
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

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = unpurchaseSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { ingredientId, restoreQuantity, restoreLow } = parsed.data

    const outcome = await unpurchaseIngredient(household.id, ingredientId, {
      restoreQuantity,
      restoreLow,
    })

    if (outcome === 'not_in_pantry') {
      return NextResponse.json({ error: 'Item not found in pantry' }, { status: 404 })
    }

    if (outcome === 'too_old') {
      return NextResponse.json(
        {
          error: `Cannot unpurchase items added more than ${UNPURCHASE_WINDOW_DAYS} days ago`,
          reason: 'too_old',
        },
        { status: 400 },
      )
    }

    return NextResponse.json(
      {
        success: true,
        ingredientId,
        // A staple stays in the pantry at 0 ("ran out") instead (HON-1398), and
        // `restoreQuantity` or `restoreLow` keeps the row at that quantity or
        // low again, or as it is when the household set an amount after the
        // purchase: `has_quantity` (HON-1438, HON-1586).
        action: outcome,
      },
      { status: 200 },
    )
  } catch (error) {
    captureApiError(error, { route: '/api/shopping-list/unpurchase', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to unmark item as purchased' }, { status: 500 })
  }
}
