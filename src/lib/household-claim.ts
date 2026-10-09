import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * One user belongs to at most one household. The schema enforces that: a
 * unique index on `household_member."userId"` (HON-696) — nullable, so
 * PostgreSQL's NULLS DISTINCT still permits the many manual member rows with
 * no user. Whatever the isolation level, and whichever code path writes the
 * row, a second membership for the same user fails with `P2002`.
 *
 * The places that create a membership — `POST /api/households`
 * (onboarding), `POST /api/invites/[code]/join`, and the sign-up after-hook for
 * an invite link (HON-1131) — also check "does this user already have a
 * membership?" before writing, and the two routes catch the `P2002`
 * ({@link isMembershipConflict}) so that the index firing produces the same
 * `already_in_household` 400 the check does, not a 500.
 *
 * **Why a per-user row lock, and not `Serializable` (HON-838).** At read
 * committed with no lock, the check is a `SELECT` matching zero rows, so two
 * concurrent claims for one user could each write a *different* member row
 * (HON-679). This used to be closed with `Serializable`, but SSI's predicate
 * locks are page- or relation-level on tables this small, so it aborted one
 * of *any* two concurrent claims — two strangers onboarding at the same moment
 * conflicted every time. It also raised that abort at `COMMIT`, where
 * `@prisma/adapter-pg` reports a raw `DriverAdapterError` rather than `P2034`,
 * so the retry below never fired and the loser got a 500.
 *
 * {@link lockUserForClaim} serialises exactly the claims that can conflict —
 * the same user's — and nothing else. The second claim waits on the row lock,
 * and because read committed takes a fresh snapshot per statement, its check
 * then sees the first claim's committed membership and takes the caller's
 * "already in a household" branch. The unique index remains the backstop for a
 * writer that skips this helper.
 */
const CLAIM_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const

/**
 * Locks the claiming user's row for the rest of the transaction, so two claims
 * for one user run one after the other while claims for different users never
 * wait on each other.
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: it does not conflict with the
 * `FOR KEY SHARE` a foreign-key check takes, so an unrelated insert that
 * references this user (a new session) is not held up by an onboarding claim.
 */
async function lockUserForClaim(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "user" WHERE "id" = ${userId} FOR NO KEY UPDATE`
}

/**
 * `P2034` covers a deadlock as well as a serialization failure. Neither is
 * expected at read committed with a single per-user lock, but both roll the
 * whole transaction back, so both are safe to retry.
 */
const SERIALIZATION_FAILURE = 'P2034'

/** Bounded so a conflict that never clears fails loudly instead of spinning. */
export const MAX_CLAIM_ATTEMPTS = 3

/**
 * Base of the wait between attempts. Retrying the instant the loser aborts
 * re-enters the same contention window it just lost in, so the whole budget can
 * be spent before the winner has committed.
 *
 * 50 ms is sized against how long a `P2034` actually takes to clear: the
 * conflicting transaction is a single membership check plus a handful of
 * inserts, so it commits within a few round trips, and tens of
 * milliseconds is already several round-trips of headroom. It is deliberately
 * far below Prisma's 5 s interactive-transaction timeout — see
 * {@link backoffDelayMs} for why the two do not interact.
 */
const RETRY_BASE_DELAY_MS = 50

/**
 * Ceiling on the jitter window. The doubling is there to spread a *repeated*
 * conflict, not to accumulate latency, and decorrelation comes from the jitter
 * — which a capped window still provides in full.
 *
 * Without it the worst case would be a property of this comment rather than of
 * the code: raising {@link MAX_CLAIM_ATTEMPTS} — the change that makes either
 * half of this file matter — would silently multiply the tail latency of a
 * user-facing onboarding POST, reaching a `[0, 1600)` ms final window at 7
 * attempts. Capped, each further attempt adds at most 400 ms.
 */
const MAX_RETRY_DELAY_MS = 400

/**
 * Full jitter: the wait before attempt `attempt + 1` is uniform over
 * `[0, min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS))` —
 * `[0, 50)` ms, then `[0, 100)` ms at today's budget, and never past
 * `[0, 400)`.
 *
 * Jitter is the load-bearing part, not the growth. Two transactions that lose
 * to each other and then wait the *same* fixed delay retry in lockstep and
 * reconflict; spreading each one uniformly over its whole window is what
 * decorrelates them. Full jitter rather than `base + random()` for the same
 * reason — a fixed floor is still lockstep.
 *
 * The sleep happens between `$transaction` calls, never inside one, so it does
 * not eat into any attempt's 5 s timeout: the budget is spent waiting for the
 * conflict to clear rather than burning inside a single contention window.
 *
 * Exported only so the tests can assert the ceiling directly. At
 * {@link MAX_CLAIM_ATTEMPTS} = 3 the windows are 50 ms and 100 ms, so
 * `Math.min` never picks {@link MAX_RETRY_DELAY_MS} — driving it through
 * `runHouseholdClaim` alone cannot tell a capped *window* from a capped
 * *base*, and the second silently leaves growth unbounded.
 */
export function backoffDelayMs(attempt: number): number {
  return Math.random() * Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === SERIALIZATION_FAILURE
  )
}

/** Prisma's code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002'

/**
 * True when a claim transaction was rejected by a unique index on
 * `household_member` — in practice, `household_member_userId_key`: the user
 * already has a membership. Callers map it to their `already_in_household` 400.
 *
 * Deliberately not narrowed to that one constraint. Both claim callbacks write
 * only `household_member` rows under a unique constraint that can collide —
 * every other row they create (household, preferences) is new, keyed by an id
 * generated in the same transaction — and `@@unique([householdId, userId])` is
 * the same diagnosis. Matching on `meta.target` would tie this to the shape
 * `@prisma/adapter-pg` happens to report, which is not the stable part.
 */
export function isMembershipConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION
}

/**
 * Run a membership-creating transaction for `userId` at read committed, holding
 * that user's row lock ({@link lockUserForClaim}) for the whole claim, and
 * retry a `P2034` up to {@link MAX_CLAIM_ATTEMPTS} times, with a jittered wait
 * between attempts ({@link backoffDelayMs}).
 *
 * `userId` must be the user the claim writes a membership for: the lock is what
 * keeps that user in one household, so locking anyone else reopens HON-679.
 *
 * `claim` must be idempotent across attempts — it may run more than once, and
 * only the final attempt's writes are committed. Errors the callback throws
 * deliberately (the caller's "already in a household" sentinel) propagate
 * unchanged on the first attempt; only `P2034` is retried.
 *
 * **Worst case.** A 3-attempt budget has 2 waits, of `[0, 50)` and `[0, 100)`
 * ms, so an exhausted budget adds strictly under 150 ms of waiting before the
 * `P2034` is rethrown — on top of the three attempts' own runtime, which
 * Prisma caps at 5 s each. Both callsites are user-facing POSTs on the
 * onboarding path, where 150 ms is invisible. {@link MAX_RETRY_DELAY_MS} keeps
 * that arithmetic bounded if the budget is ever raised: every attempt past the
 * fourth adds at most 400 ms rather than doubling.
 */
export async function runHouseholdClaim<T>(
  userId: string,
  claim: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockUserForClaim(tx, userId)
        return claim(tx)
      }, CLAIM_TRANSACTION_OPTIONS)
    } catch (error) {
      if (isSerializationFailure(error) && attempt < MAX_CLAIM_ATTEMPTS) {
        await sleep(backoffDelayMs(attempt))
        continue
      }
      throw error
    }
  }
}

/**
 * The user already belongs to a household, so this invite cannot claim a
 * second member row for them. The unique index on `household_member."userId"`
 * is what actually keeps one user out of two households (HON-696); this
 * check is what turns the common case into a clean error before any write.
 *
 * Thrown rather than returned because the check runs inside the transaction
 * that claims the member row — throwing is the only way to roll that claim
 * back.
 */
export class AlreadyInHouseholdError extends Error {
  constructor() {
    super('You are already a member of a household')
    this.name = 'AlreadyInHouseholdError'
  }
}

/**
 * The invite the caller read is no longer claimable by the time the
 * transaction runs: a concurrent join consumed it, or its member row was
 * deleted (which cascade-deletes the invite — see `HouseholdInvite.member`
 * `onDelete: Cascade`). Both writes in {@link claimInviteMembership} are
 * count-checked rather than allowed to raise `P2025`, so this is the single
 * signal for "the row the claim was built on is gone".
 */
export class InviteNoLongerClaimableError extends Error {
  constructor() {
    super('The invite was consumed before this request could claim it')
    this.name = 'InviteNoLongerClaimableError'
  }
}

/**
 * The claim callback for one invite: claim the invite's member row for
 * `userId` and delete the invite. Run it through {@link runHouseholdClaim}
 * with the same `userId`, which supplies the transaction and the user's row
 * lock. Shared by `POST /api/invites/[code]/join` (a signed-in user) and the
 * sign-up after-hook (a user created from the invite link, HON-1131).
 *
 * It claims the existing member profile instead of creating a new one. The
 * "already in a household" check runs on `tx`, and `runHouseholdClaim` holds
 * this user's row lock for the whole transaction, so two concurrent joins with
 * different valid codes cannot both observe "no membership" and both commit
 * (HON-679, HON-838). The unique index on `"userId"` backs that up
 * unconditionally (HON-696).
 *
 * Throws {@link AlreadyInHouseholdError} or {@link InviteNoLongerClaimableError};
 * the index can also reject it with a `P2002` ({@link isMembershipConflict}).
 * Idempotent across attempts, as `runHouseholdClaim` requires: every write is
 * conditional, and a rolled-back attempt leaves nothing behind.
 */
export function inviteMembershipClaim(
  userId: string,
  memberId: string,
  inviteId: string,
): (tx: Prisma.TransactionClient) => Promise<void> {
  return async (tx) => {
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
    // row is gone entirely.
    const claimed = await tx.householdMember.updateMany({
      where: { id: memberId, userId: null },
      data: { userId },
    })

    if (claimed.count === 0) {
      throw new InviteNoLongerClaimableError()
    }

    // Deleting the invite is what makes it single-use: there is no uses
    // counter, so the absence of the row is the whole enforcement (HON-680).
    // Count-checked for the same reason as the claim above: the loser of a
    // race for one shared link must get the sentinel, not a `P2025`.
    const consumed = await tx.householdInvite.deleteMany({
      where: { id: inviteId },
    })

    if (consumed.count === 0) {
      throw new InviteNoLongerClaimableError()
    }
  }
}
