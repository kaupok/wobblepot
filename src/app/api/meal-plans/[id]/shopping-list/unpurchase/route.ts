import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { ShoppingPlanError, type ShoppingPlanRefusal } from '@/lib/shopping/load-shopping-list'
import {
  restoreQuantitySchema,
  UNPURCHASE_WINDOW_DAYS,
  unpurchasePlanIngredient,
} from '@/lib/shopping/purchase'

const unpurchaseSchema = z.object({
  ingredientId: z.string().min(1),
  restoreQuantity: restoreQuantitySchema.optional(),
  // The `replacedLow` a purchase returned (HON-1586).
  restoreLow: z.boolean().optional(),
})

const REFUSALS: Record<ShoppingPlanRefusal, { status: number; error: string }> = {
  planNotFound: { status: 404, error: 'Meal plan not found' },
  otherHousehold: { status: 403, error: 'Access denied to this meal plan' },
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const { id: planId } = await params

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

    const outcome = await unpurchasePlanIngredient(household.id, planId, ingredientId, {
      restoreQuantity,
      restoreLow,
    })
    switch (outcome) {
      case 'not_in_pantry':
        return NextResponse.json({ error: 'Item not found in pantry' }, { status: 404 })
      case 'too_old':
        return NextResponse.json(
          {
            error: `Cannot unpurchase items added more than ${UNPURCHASE_WINDOW_DAYS} days ago`,
            reason: 'too_old',
          },
          { status: 400 },
        )
      // A staple stays in the pantry at 0 ("ran out") instead (HON-1398), and
      // `restoreQuantity` keeps the row at that quantity (HON-1438), and
      // `restoreLow` keeps it running low (HON-1586).
      case 'removed':
      case 'ran_out':
      case 'restored':
      // Only with `restoreQuantity` or `restoreLow`: the household set an amount after the
      // purchase, so the row stays as it is.
      case 'has_quantity':
        return NextResponse.json({ success: true, ingredientId, action: outcome }, { status: 200 })
    }
  } catch (error) {
    if (error instanceof ShoppingPlanError) {
      const { status, error: message } = REFUSALS[error.reason]
      return NextResponse.json({ error: message }, { status })
    }
    captureApiError(error, {
      route: '/api/meal-plans/[id]/shopping-list/unpurchase',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to unmark item as purchased' }, { status: 500 })
  }
}
