import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { getServerBaseURL } from '@/lib/env'

const createInviteSchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
  maxUses: z.number().int().min(1).max(100).optional().default(5),
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

  const { expiresInDays, maxUses } = parsed.data
  const code = nanoid(12)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)

  const invite = await prisma.householdInvite.create({
    data: {
      householdId: membership.householdId,
      code,
      expiresAt,
      maxUses,
    },
  })

  return NextResponse.json(
    {
      id: invite.id,
      code: invite.code,
      url: `${baseUrl}/invite/${invite.code}`,
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

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only household owners can view invites' }, { status: 403 })
  }

  const invites = await prisma.householdInvite.findMany({
    where: { householdId: membership.householdId },
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
        expiresAt: invite.expiresAt.toISOString(),
        maxUses: invite.maxUses,
        usesCount: invite.usesCount,
        isActive: !isExpired && !isMaxedOut,
        createdAt: invite.createdAt.toISOString(),
      }
    }),
  })
}
