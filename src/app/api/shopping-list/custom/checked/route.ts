import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'

/**
 * DELETE /api/shopping-list/custom/checked
 *
 * Remove all checked custom shopping items for the household.
 */
export async function DELETE() {
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

  const { household } = membership

  try {
    const result = await prisma.customShoppingItem.deleteMany({
      where: {
        householdId: household.id,
        checked: true,
      },
    })

    return NextResponse.json({ success: true, deletedCount: result.count }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/shopping-list/custom/checked',
      userId: session.user.id,
      householdId: household.id,
    })
    return NextResponse.json({ error: 'Failed to delete checked items' }, { status: 500 })
  }
}
