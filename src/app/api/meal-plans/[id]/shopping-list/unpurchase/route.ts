import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { ShoppingPlanError, type ShoppingPlanRefusal } from '@/lib/shopping/load-shopping-list'
import { unpurchasePlanIngredient, UNPURCHASE_WINDOW_DAYS } from '@/lib/shopping/purchase'

const unpurchaseSchema = z.object({
  ingredientId: z.string().min(1),
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

    const { ingredientId } = parsed.data

    const outcome = await unpurchasePlanIngredient(household.id, planId, ingredientId)
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
      // A staple stays in the pantry at 0 ("ran out") instead (HON-1398).
      case 'removed':
      case 'ran_out':
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
