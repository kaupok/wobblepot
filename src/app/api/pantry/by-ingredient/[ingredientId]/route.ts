import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { deletePantryItemByIngredient } from '@/lib/pantry/pantry-items'

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
