import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { ShoppingPlanError, type ShoppingPlanRefusal } from '@/lib/shopping/load-shopping-list'
import { purchasePlanIngredients } from '@/lib/shopping/purchase'

const purchaseSchema = z
  .object({
    ingredientId: z.string().min(1).optional(),
    // `.min(1)` because the refine below tests truthiness and `[]` is truthy:
    // without it `{ ingredientIds: [] }` purchases nothing with a 200, and
    // `{ ingredientId, ingredientIds: [] }` silently drops the `ingredientId`
    // (HON-659).
    ingredientIds: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((data) => data.ingredientId || data.ingredientIds, {
    message: 'Either ingredientId or ingredientIds must be provided',
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

    const parsed = purchaseSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ingredientIds = parsed.data.ingredientIds ?? [parsed.data.ingredientId!]

    // The plan check, the ingredient scoping and the pantry transaction live in
    // `purchasePlanIngredients`, shared with `/api/shopping-list/purchase`
    // (HON-1208).
    const outcome = await purchasePlanIngredients(household, planId, ingredientIds)

    if (outcome.status === 'invalid_ids') {
      return NextResponse.json(
        { error: 'Invalid ingredient IDs', invalidIds: outcome.invalidIds },
        { status: 400 },
      )
    }

    // `replacedQuantity` goes back on an undo as `restoreQuantity` (HON-1438).
    return NextResponse.json({ success: true, results: outcome.results }, { status: 200 })
  } catch (error) {
    if (error instanceof ShoppingPlanError) {
      const { status, error: message } = REFUSALS[error.reason]
      return NextResponse.json({ error: message }, { status })
    }
    captureApiError(error, {
      route: '/api/meal-plans/[id]/shopping-list/purchase',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to mark item as purchased' }, { status: 500 })
  }
}
