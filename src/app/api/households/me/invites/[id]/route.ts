import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

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

    if (membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only household owners can revoke invites' },
        { status: 403 },
      )
    }

    const { id } = await params

    const invite = await prisma.householdInvite.findFirst({
      where: {
        id,
        householdId: membership.householdId,
      },
    })

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    await prisma.householdInvite.delete({
      where: { id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Failed to delete invite:', error)
    return NextResponse.json({ error: 'Failed to delete invite' }, { status: 500 })
  }
}
