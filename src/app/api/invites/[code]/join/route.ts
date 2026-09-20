import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { Prisma } from '@/generated/prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'

/**
 * The user already belongs to a household, so this invite cannot claim a
 * second member row for them. `@@unique([householdId, userId])` only guards
 * against a duplicate row *within* one household, and there is no unique
 * index on `userId` alone, so this check is the only thing keeping one user
 * out of two households (HON-679).
 *
 * Thrown rather than returned because the check runs inside the same
 * transaction that claims the member row — throwing is the only way to roll
 * that claim back. The outer `catch` turns it into the same 400 the
 * standalone check used to return directly; `JoinHouseholdCard` branches on
 * that exact `error` string, so the body must not drift.
 */
class AlreadyInHouseholdError extends Error {
  constructor() {
    super('You are already a member of a household')
    this.name = 'AlreadyInHouseholdError'
  }
}

/**
 * The invite read at the top of the handler is no longer claimable by the
 * time the transaction runs: a concurrent join consumed it, or its member row
 * was deleted (which cascade-deletes the invite — see `HouseholdInvite.member`
 * `onDelete: Cascade`). Both writes below are count-checked rather than
 * allowed to raise `P2025`, so this is the single signal for "the row the
 * claim was built on is gone".
 *
 * Mapped to the same 404 the sequential path already returns when
 * `findUnique` misses, so a lost race and a stale link are indistinguishable
 * to the client — which is correct, because they are the same thing to the
 * user.
 */
class InviteNoLongerClaimableError extends Error {
  constructor() {
    super('The invite was consumed before this request could claim it')
    this.name = 'InviteNoLongerClaimableError'
  }
}

/**
 * `Serializable` is load-bearing, not belt-and-braces. At PostgreSQL's default
 * `read committed`, the membership check is a `SELECT` matching **zero** rows,
 * so it takes no lock: two concurrent joins for the same user with two
 * different valid codes update two *different* member rows, never conflict,
 * and both commit. That is write skew, and sharing a transaction does not stop
 * it — only predicate locks (SSI) do. `REPEATABLE READ` is not enough either;
 * PostgreSQL only detects conflicting updates to the *same* row there.
 *
 * The durable fix is a unique index on `household_member.user_id`, which would
 * make the invariant unconditional and also cover `POST /api/households`
 * (same shape, same gap). That is a migration against existing data and is
 * tracked separately.
 */
const JOIN_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const

/**
 * SSI aborts the loser of a conflict with `40001`, surfaced by Prisma as
 * `P2034`. These are expected under `Serializable` and are safe to retry: the
 * whole transaction rolled back, and the retry re-reads the membership state
 * the winner just committed, so the losing join deterministically resolves to
 * the `already_in_household` 400 rather than to a 500.
 */
const SERIALIZATION_FAILURE = 'P2034'
const MAX_TRANSACTION_ATTEMPTS = 3

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === SERIALIZATION_FAILURE
  )
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
    // transaction: the claim's own count checks are what make it single-use,
    // so re-reading the invite inside the callback would only widen the
    // transaction's footprint.
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
    const inviteId = invite.id
    const userId = session.user.id

    // Claim the existing member profile instead of creating a new one. The
    // "already in a household" check runs on `tx`, under `Serializable`, so
    // two concurrent joins with different valid codes cannot both observe "no
    // membership" and both commit (HON-679).
    const claimMembership = async (tx: Prisma.TransactionClient) => {
      const existingMembership = await tx.householdMember.findFirst({
        where: { userId },
      })

      if (existingMembership) {
        throw new AlreadyInHouseholdError()
      }

      // `updateMany` with `userId: null`, not `update`: this is a claim of an
      // *unclaimed* row, and expressing that as a conditional write means a
      // member row that a concurrent join already claimed matches nothing
      // instead of being silently overwritten. It also avoids `P2025` when the
      // row is gone entirely, which `update` would raise and the catch below
      // would turn into a 500.
      const claimed = await tx.householdMember.updateMany({
        where: { id: memberId, userId: null },
        data: { userId },
      })

      if (claimed.count === 0) {
        throw new InviteNoLongerClaimableError()
      }

      // Delete the invite after use. Count-checked for the same reason: the
      // loser of a race for one shared link must get the sequential path's 404,
      // not a `P2025` that falls through to a 500.
      const consumed = await tx.householdInvite.deleteMany({
        where: { id: inviteId },
      })

      if (consumed.count === 0) {
        throw new InviteNoLongerClaimableError()
      }
    }

    for (let attempt = 1; ; attempt++) {
      try {
        await prisma.$transaction(claimMembership, JOIN_TRANSACTION_OPTIONS)
        break
      } catch (error) {
        if (isSerializationFailure(error) && attempt < MAX_TRANSACTION_ATTEMPTS) {
          continue
        }
        throw error
      }
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
    // Both sentinels are checked before `captureApiError`: they are expected
    // client errors, not server faults, and reporting them would both noise up
    // PostHog and fall through to a 500 that the client's error branches
    // cannot read.
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

    if (error instanceof InviteNoLongerClaimableError) {
      return NextResponse.json(
        {
          error: 'invite_not_found',
          message: 'Invite code not found.',
        },
        { status: 404 },
      )
    }

    captureApiError(error, { route: '/api/invites/[code]/join', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to join household' }, { status: 500 })
  }
}
