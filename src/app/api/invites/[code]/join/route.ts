import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client'
import { auth } from '@/lib/auth'
import {
  AlreadyInHouseholdError,
  InviteNoLongerClaimableError,
  inviteMembershipClaim,
  isMembershipConflict,
  runHouseholdClaim,
} from '@/lib/household-claim'
import {
  afterHouseholdLeft,
  leaveHousehold,
  NotInHouseholdError,
  OwnerHasOtherAccountsError,
  type LeaveHouseholdResult,
} from '@/lib/household-leave'
import { findHouseholdInvite, getInviteValidity } from '@/lib/household-invite'
import { captureApiError } from '@/lib/errors'

const ROUTE = '/api/invites/[code]/join'

/**
 * Optional. `leaveCurrent: true` leaves the user's current household in the
 * same transaction as the claim, so a failed claim keeps the old household
 * (HON-1133). With no body the route behaves as before.
 */
const joinBodySchema = z.object({ leaveCurrent: z.boolean().optional() })

/** {@link leaveHousehold}, or `null` when the user has no household to leave. */
async function leaveIfMember(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<LeaveHouseholdResult | null> {
  try {
    return await leaveHousehold(tx, userId)
  } catch (error) {
    // Thrown before any write, so catching it does not abort the transaction.
    if (error instanceof NotInHouseholdError) return null
    throw error
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { code } = await params

    let leaveCurrent = false
    const rawBody = await request.text()
    if (rawBody.trim()) {
      let json: unknown
      try {
        json = JSON.parse(rawBody)
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
      }
      const parsed = joinBodySchema.safeParse(json)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
      }
      leaveCurrent = parsed.data.leaveCurrent === true
    }

    // Find invite by code. This and the validity checks below stay outside the
    // transaction: the claim's own count checks are what make it single-use,
    // so re-reading the invite inside the callback would only widen the
    // transaction's footprint.
    const invite = await findHouseholdInvite(code)

    // A used invite no longer exists, because claiming it deletes the row, so
    // a second join on the same code lands here rather than on a validity
    // check (HON-680).
    if (!invite) {
      return NextResponse.json(
        {
          error: 'invite_not_found',
          message: 'Invite code not found.',
        },
        { status: 404 },
      )
    }

    // Every reason maps to the same `invite_invalid` 400, so an invitee is not
    // told that the owner is pending account deletion (HON-881).
    // `JoinHouseholdCard` branches on that exact `error` string.
    const validity = getInviteValidity(invite)
    if (validity !== 'valid' || !invite.memberId || !invite.member) {
      if (validity === 'owner_pending_deletion') {
        // eslint-disable-next-line no-console
        console.warn(
          `[invites/join] refused invite ${invite.id}: household ${invite.household.id} owner is pending account deletion`,
        )
      }
      return NextResponse.json(
        {
          error: 'invite_invalid',
          message:
            validity === 'expired'
              ? 'This invite has expired or has already been used.'
              : 'This invite is no longer valid.',
        },
        { status: 400 },
      )
    }

    // `runHouseholdClaim` holds this user's row lock for the whole claim; see
    // `inviteMembershipClaim` for why that keeps one user in one household.
    const userId = session.user.id
    const claim = inviteMembershipClaim(userId, invite.memberId, invite.id)
    const inviteHouseholdId = invite.household.id
    const left = await runHouseholdClaim(userId, async (tx) => {
      // With `leaveCurrent`, the leave runs first on the same transaction, so
      // the claim's "already in a household" check then sees no membership.
      // A claim that fails after it rolls the leave back with it (HON-1133).
      const leftHousehold = leaveCurrent ? await leaveIfMember(tx, userId) : null
      // An invite into the household being left is not a move: for a sole
      // owner the leave has just deleted the household and the invite with it.
      if (leftHousehold?.householdId === inviteHouseholdId) {
        throw new AlreadyInHouseholdError()
      }
      await claim(tx)
      return leftHousehold
    })

    if (left) {
      await afterHouseholdLeft(left, { route: ROUTE, userId })
    }

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
    // Both sentinels, and the index's `P2002`, are checked before
    // `captureApiError`: they are expected client errors, not server faults,
    // and reporting them would both noise up PostHog and fall through to a 500
    // that the client's error branches cannot read.
    // `isMembershipConflict`: the claim's `updateMany` was rejected by the
    // unique index on `household_member."userId"` — a concurrent join or
    // create committed a membership for this user first (HON-696).
    if (error instanceof AlreadyInHouseholdError || isMembershipConflict(error)) {
      return NextResponse.json(
        {
          error: 'already_in_household',
          message:
            'You are already a member of a household. Leave your current household to join another.',
        },
        { status: 400 },
      )
    }

    // Same body as `POST /api/households/me/leave`: an owner with other
    // account holders removes them first.
    if (error instanceof OwnerHasOtherAccountsError) {
      return NextResponse.json(
        { error: 'owner_has_other_accounts', count: error.otherAccountCount },
        { status: 409 },
      )
    }

    if (error instanceof InviteNoLongerClaimableError) {
      return NextResponse.json(
        {
          error: 'invite_invalid',
          message: 'This invite has expired or has already been used.',
        },
        { status: 400 },
      )
    }

    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to join household' }, { status: 500 })
  }
}
