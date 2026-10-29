import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { HouseholdInviteError, revokeHouseholdInvite } from '@/lib/household-invite'

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

    const { id } = await params
    await revokeHouseholdInvite(membership, id)

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof HouseholdInviteError) {
      if (error.reason === 'notOwner') {
        return NextResponse.json(
          { error: 'Only household owners can revoke invites' },
          { status: 403 },
        )
      }
      if (error.reason === 'inviteNotFound') {
        return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
      }
    }
    captureApiError(error, { route: '/api/households/me/invites/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete invite' }, { status: 500 })
  }
}
