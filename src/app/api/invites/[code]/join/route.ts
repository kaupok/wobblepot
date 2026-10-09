import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import {
  AlreadyInHouseholdError,
  InviteNoLongerClaimableError,
  inviteMembershipClaim,
  isMembershipConflict,
  runHouseholdClaim,
} from '@/lib/household-claim'
import { findHouseholdInvite, getInviteValidity } from '@/lib/household-invite'
import { captureApiError } from '@/lib/errors'

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
    await runHouseholdClaim(userId, inviteMembershipClaim(userId, invite.memberId, invite.id))

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

    if (error instanceof InviteNoLongerClaimableError) {
      return NextResponse.json(
        {
          error: 'invite_invalid',
          message: 'This invite has expired or has already been used.',
        },
        { status: 400 },
      )
    }

    captureApiError(error, { route: '/api/invites/[code]/join', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to join household' }, { status: 500 })
  }
}
