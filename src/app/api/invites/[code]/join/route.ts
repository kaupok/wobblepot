import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if user already has a household membership
  const existingMembership = await prisma.householdMember.findFirst({
    where: { userId: session.user.id },
  })

  if (existingMembership) {
    return NextResponse.json(
      {
        error: 'already_in_household',
        message:
          'You are already a member of a household. Leave your current household to join another.',
      },
      { status: 400 },
    )
  }

  const { code } = await params

  // Find invite by code
  const invite = await prisma.householdInvite.findUnique({
    where: { code },
    include: {
      household: {
        select: { id: true, name: true },
      },
    },
  })

  if (!invite) {
    return NextResponse.json(
      {
        error: 'invite_not_found',
        message: 'Invite code not found.',
      },
      { status: 404 },
    )
  }

  // Validate invite is still active
  const now = new Date()
  const isExpired = invite.expiresAt < now
  const isMaxedOut = invite.maxUses !== null && invite.usesCount >= invite.maxUses

  if (isExpired || isMaxedOut) {
    return NextResponse.json(
      {
        error: 'invite_invalid',
        message: 'This invite has expired or reached its maximum uses.',
      },
      { status: 400 },
    )
  }

  // Join household in a transaction
  await prisma.$transaction([
    prisma.householdMember.create({
      data: {
        householdId: invite.householdId,
        userId: session.user.id,
        role: 'member',
      },
    }),
    prisma.householdInvite.update({
      where: { id: invite.id },
      data: { usesCount: { increment: 1 } },
    }),
  ])

  return NextResponse.json({
    success: true,
    household: {
      id: invite.household.id,
      name: invite.household.name,
    },
  })
}
