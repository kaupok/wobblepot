import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'

/**
 * The user already belongs to a household, so this invite cannot claim a
 * second member row for them. `@@unique([householdId, userId])` only guards
 * against a duplicate row *within* one household, so this check is the only
 * thing keeping one user out of two households (HON-679).
 *
 * Thrown rather than returned because the check runs inside the same
 * interactive transaction that claims the member row — throwing is the only
 * way to roll that claim back. The outer `catch` turns it into the same 400
 * the standalone check used to return directly; `JoinHouseholdCard` branches
 * on that exact `error` string, so the body must not drift.
 */
class AlreadyInHouseholdError extends Error {
  constructor() {
    super('You are already a member of a household')
    this.name = 'AlreadyInHouseholdError'
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { code } = await params

    // Find invite by code. This and the validity checks below stay outside the
    // transaction: the `delete` is what makes the claim single-use, so
    // re-reading the invite inside the callback buys nothing.
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

    const memberId = invite.memberId

    // Claim the existing member profile instead of creating a new one. The
    // "already in a household" check runs on `tx`, inside the same transaction
    // as the claim, so two concurrent joins with different valid codes cannot
    // both observe "no membership" and both commit (HON-679). Mirrors
    // `POST /api/households` (src/app/api/households/route.ts).
    await prisma.$transaction(async (tx) => {
      const existingMembership = await tx.householdMember.findFirst({
        where: { userId: session.user.id },
      })

      if (existingMembership) {
        throw new AlreadyInHouseholdError()
      }

      // Update the existing member to link to the user
      await tx.householdMember.update({
        where: { id: memberId },
        data: { userId: session.user.id },
      })

      // Delete the invite after use
      await tx.householdInvite.delete({
        where: { id: invite.id },
      })
    })

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
    // Checked before `captureApiError`: this is an expected 400, not a server
    // error, and reporting it would both noise up PostHog and fall through to
    // the 500 that `JoinHouseholdCard`'s error branch cannot read.
    if (error instanceof AlreadyInHouseholdError) {
      return NextResponse.json(
        {
          error: 'already_in_household',
          message:
            'You are already a member of a household. Leave your current household to join another.',
        },
        { status: 400 },
      )
    }

    captureApiError(error, { route: '/api/invites/[code]/join', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to join household' }, { status: 500 })
  }
}
