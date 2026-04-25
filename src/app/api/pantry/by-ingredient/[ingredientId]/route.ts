import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'

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

    // Find and delete the pantry item by ingredientId for this household
    const pantryItem = await prisma.pantryItem.findUnique({
      where: {
        householdId_ingredientId: {
          householdId: membership.householdId,
          ingredientId,
        },
      },
    })

    if (!pantryItem) {
      return NextResponse.json({ error: 'Pantry item not found' }, { status: 404 })
    }

    await prisma.pantryItem.delete({
      where: { id: pantryItem.id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, { route: '/api/pantry/by-ingredient/[ingredientId]' })
    return NextResponse.json({ error: 'Failed to delete pantry item' }, { status: 500 })
  }
}
