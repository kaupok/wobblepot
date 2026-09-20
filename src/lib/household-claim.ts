import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * One user belongs to at most one household. Nothing in the schema enforces
 * that: `HouseholdMember` has `@@unique([householdId, userId])`, which only
 * stops a duplicate row *within* one household, and `@@index([userId])` is not
 * unique. The invariant therefore lives in application code, in the two places
 * that create a membership — `POST /api/households` (onboarding) and
 * `POST /api/invites/[code]/join`.
 *
 * Both check "does this user already have a membership?" and then write. That
 * is only safe under `Serializable`. At PostgreSQL's default `read committed`
 * the check is a `SELECT` matching zero rows, so it takes no lock, and two
 * concurrent requests write two *different* member rows — no conflict, both
 * commit, user in two households (HON-679). `repeatable read` does not help
 * either: PostgreSQL only detects conflicting updates to the *same* row there.
 * This is write skew, and SSI's predicate locks are what catch it.
 *
 * **Both sides must opt in.** PostgreSQL registers a serialization conflict
 * only when the writing transaction is itself serializable, so a serializable
 * join racing a `read committed` onboarding create still commits twice. That
 * is why this helper exists rather than an options object copied into one
 * route: the guarantee is a property of the *pair*, and a callsite that
 * forgets it silently reopens the hole at both ends.
 *
 * The durable fix is a unique index on `household_member.user_id` — nullable,
 * so PostgreSQL's NULLS DISTINCT still permits the many manual member rows
 * with no user. That is a migration against existing data, and needs an audit
 * for rows this race already created, so it is tracked as HON-696. Until it
 * lands, every membership-creating transaction must go through here.
 */
const CLAIM_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const

/**
 * SSI aborts the loser of a conflict with `40001`, which `@prisma/adapter-pg`
 * surfaces as `P2034`. These are expected under `Serializable` and safe to
 * retry: the whole transaction rolled back, so the retry re-reads the
 * membership the winner just committed and resolves deterministically to the
 * caller's "already in a household" branch rather than to a 500.
 */
const SERIALIZATION_FAILURE = 'P2034'

/** Bounded so a conflict that never clears fails loudly instead of spinning. */
export const MAX_CLAIM_ATTEMPTS = 3

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === SERIALIZATION_FAILURE
  )
}

/**
 * Run a membership-creating transaction at `Serializable`, retrying
 * serialization failures up to {@link MAX_CLAIM_ATTEMPTS} times.
 *
 * `claim` must be idempotent across attempts — it may run more than once, and
 * only the final attempt's writes are committed. Errors the callback throws
 * deliberately (the caller's "already in a household" sentinel) propagate
 * unchanged on the first attempt; only `P2034` is retried.
 */
export async function runHouseholdClaim<T>(
  claim: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(claim, CLAIM_TRANSACTION_OPTIONS)
    } catch (error) {
      if (isSerializationFailure(error) && attempt < MAX_CLAIM_ATTEMPTS) {
        continue
      }
      throw error
    }
  }
}
