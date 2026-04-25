import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { getServerBaseURL } from '@/lib/env'
import { captureApiError } from '@/lib/errors'

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

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only household owners can create invites' }, { status: 403 })
  }

  const baseUrl = getServerBaseURL()

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

  const { memberId, expiresInDays } = parsed.data

  // Validate the member exists, belongs to this household, and is a manual member
  const member = await prisma.householdMember.findFirst({
    where: {
      id: memberId,
      householdId: membership.householdId,
    },
  })

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  if (member.userId !== null) {
    return NextResponse.json(
      {
        error: 'Can only create invites for manual members (members without a linked user account)',
      },
      { status: 400 },
    )
  }

  const code = nanoid(12)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)

  // Upsert: if an invite already exists for this member, replace it
  const invite = await prisma.householdInvite.upsert({
    where: { memberId },
    create: {
      householdId: membership.householdId,
      memberId,
      code,
      expiresAt,
      maxUses: 1,
    },
    update: {
      code,
      expiresAt,
      usesCount: 0,
    },
  })

  return NextResponse.json(
    {
      id: invite.id,
      code: invite.code,
      url: `${baseUrl}/invite/${invite.code}`,
      memberId: invite.memberId,
      memberName: member.name,
      expiresAt: invite.expiresAt.toISOString(),
      maxUses: invite.maxUses,
      usesCount: invite.usesCount,
      createdAt: invite.createdAt.toISOString(),
    },
    { status: 201 },
  )
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

    if (membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only household owners can view invites' }, { status: 403 })
    }

    const invites = await prisma.householdInvite.findMany({
      where: { householdId: membership.householdId },
      include: {
        member: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const baseUrl = getServerBaseURL()
    const now = new Date()

    return NextResponse.json({
      invites: invites.map((invite) => {
        const isExpired = invite.expiresAt < now
        // null maxUses means unlimited uses
        const isMaxedOut = invite.maxUses !== null && invite.usesCount >= invite.maxUses

        return {
          id: invite.id,
          code: invite.code,
          url: `${baseUrl}/invite/${invite.code}`,
          memberId: invite.memberId,
          memberName: invite.member?.name ?? null,
          expiresAt: invite.expiresAt.toISOString(),
          maxUses: invite.maxUses,
          usesCount: invite.usesCount,
          isActive: !isExpired && !isMaxedOut,
          createdAt: invite.createdAt.toISOString(),
        }
      }),
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/invites', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 })
  }
}
