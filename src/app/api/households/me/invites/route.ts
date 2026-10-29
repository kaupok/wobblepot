import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import {
  createHouseholdInvite,
  HouseholdInviteError,
  listHouseholdInvites,
} from '@/lib/household-invite'

const createInviteSchema = z.object({
  memberId: z.string().min(1),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
})

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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      // Allow empty body - schema defaults will be applied
      body = {}
    }

    const parsed = createInviteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const invite = await createHouseholdInvite(
      membership,
      parsed.data.memberId,
      parsed.data.expiresInDays,
    )

    return NextResponse.json(invite, { status: 201 })
  } catch (error) {
    if (error instanceof HouseholdInviteError) {
      switch (error.reason) {
        case 'notOwner':
          return NextResponse.json(
            { error: 'Only household owners can create invites' },
            { status: 403 },
          )
        case 'memberNotFound':
          return NextResponse.json({ error: 'Member not found' }, { status: 404 })
        case 'memberClaimed':
          return NextResponse.json(
            {
              error:
                'Can only create invites for manual members (members without a linked user account)',
            },
            { status: 400 },
          )
      }
    }
    captureApiError(error, { route: '/api/households/me/invites', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
  }
}

export async function GET() {
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

    const invites = await listHouseholdInvites(membership)

    return NextResponse.json({ invites })
  } catch (error) {
    if (error instanceof HouseholdInviteError && error.reason === 'notOwner') {
      return NextResponse.json({ error: 'Only household owners can view invites' }, { status: 403 })
    }
    captureApiError(error, { route: '/api/households/me/invites', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 })
  }
}
