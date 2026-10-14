import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import {
  loadPlanShoppingList,
  ShoppingPlanError,
  type ShoppingPlanRefusal,
} from '@/lib/shopping/load-shopping-list'
import { captureApiError } from '@/lib/errors'

const REFUSALS: Record<ShoppingPlanRefusal, { status: number; error: string }> = {
  planNotFound: { status: 404, error: 'Meal plan not found' },
  otherHousehold: { status: 403, error: 'Access denied to this meal plan' },
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { id } = await params

  try {
    // The read, the purchase status and the formatting live in
    // `loadPlanShoppingList`, in the household's locale (HON-921, HON-1208).
    const list = await loadPlanShoppingList(membership.household, id)
    return NextResponse.json(list, { status: 200 })
  } catch (error) {
    if (error instanceof ShoppingPlanError) {
      const { status, error: message } = REFUSALS[error.reason]
      return NextResponse.json({ error: message }, { status })
    }
    captureApiError(error, { route: '/api/meal-plans/[id]/shopping-list', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch shopping list' }, { status: 500 })
  }
}
