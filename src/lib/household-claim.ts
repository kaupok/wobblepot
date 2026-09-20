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

/**
 * Base of the wait between attempts. Retrying the instant the loser aborts
 * re-enters the same contention window it just lost in, so the whole budget can
 * be spent before the winner has committed.
 *
 * 50 ms is sized against how long a `P2034` actually takes to clear: the
 * conflicting transaction is a single membership check plus a handful of
 * inserts, so it commits in single-digit milliseconds here, and tens of
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

/**
 * Run a membership-creating transaction at `Serializable`, retrying
 * serialization failures up to {@link MAX_CLAIM_ATTEMPTS} times, with a
 * jittered wait between attempts ({@link backoffDelayMs}).
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
  claim: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(claim, CLAIM_TRANSACTION_OPTIONS)
    } catch (error) {
      if (isSerializationFailure(error) && attempt < MAX_CLAIM_ATTEMPTS) {
        await sleep(backoffDelayMs(attempt))
        continue
      }
      throw error
    }
  }
}
