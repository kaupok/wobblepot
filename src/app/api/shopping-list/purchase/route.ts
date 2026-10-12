import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import {
  ingredientIdSchema,
  ingredientIdsSchema,
  purchaseIngredients,
} from '@/lib/shopping/purchase'

const purchaseSchema = z
  .object({
    ingredientId: ingredientIdSchema.optional(),
    // Non-empty because the refine below tests truthiness and `[]` is truthy:
    // without it `{ ingredientIds: [] }` purchases nothing with a 200, and
    // `{ ingredientId, ingredientIds: [] }` silently drops the `ingredientId`
    // (HON-659).
    ingredientIds: ingredientIdsSchema.optional(),
  })
  .refine((data) => data.ingredientId || data.ingredientIds, {
    message: 'Either ingredientId or ingredientIds must be provided',
  })

/**
 * POST /api/shopping-list/purchase
 *
 * Mark shopping list item(s) as purchased by adding to pantry.
 * Works with the rolling window shopping list (not tied to a specific plan).
 * The `mark_purchased` MCP tool calls the same `purchaseIngredients`.
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

    const parsed = purchaseSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Normalize to array
    const ingredientIds = parsed.data.ingredientIds ?? [parsed.data.ingredientId!]

    const outcome = await purchaseIngredients(household, ingredientIds)
    if (outcome.status === 'invalid_ids') {
      return NextResponse.json(
        { error: 'Invalid ingredient IDs', invalidIds: outcome.invalidIds },
        { status: 400 },
      )
    }
    const { results } = outcome

    return NextResponse.json({ success: true, results }, { status: 200 })
  } catch (error) {
    captureApiError(error, { route: '/api/shopping-list/purchase', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to mark item as purchased' }, { status: 500 })
  }
}
