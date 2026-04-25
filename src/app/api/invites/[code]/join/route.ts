import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
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
        member: {
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

    // Member-specific invites must have a memberId
    if (!invite.memberId || !invite.member) {
      return NextResponse.json(
        {
          error: 'invite_invalid',
          message: 'This invite is no longer valid.',
        },
        { status: 400 },
      )
    }

    // Claim the existing member profile instead of creating a new one
    await prisma.$transaction([
      // Update the existing member to link to the user
      prisma.householdMember.update({
        where: { id: invite.memberId },
        data: { userId: session.user.id },
      }),
      // Delete the invite after use
      prisma.householdInvite.delete({
        where: { id: invite.id },
      }),
    ])

    return NextResponse.json({
      success: true,
      household: {
        id: invite.household.id,
        name: invite.household.name,
      },
      member: {
        id: invite.member.id,
        name: invite.member.name,
      },
    })
  } catch (error) {
    captureApiError(error, { route: '/api/invites/[code]/join', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to join household' }, { status: 500 })
  }
}
