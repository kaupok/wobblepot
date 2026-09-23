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
 * The two places that create a membership — `POST /api/households`
 * (onboarding) and `POST /api/invites/[code]/join` — also check "does this user
 * already have a membership?" before writing, and they catch the `P2002`
 * ({@link isMembershipConflict}) so that the index firing produces the same
 * `already_in_household` 400 the check does, not a 500.
 *
 * **Why this still runs at `Serializable` (HON-696 kept it deliberately).**
 * Before the index existed, isolation *was* the enforcement (HON-679): at
 * `read committed` the check is a `SELECT` matching zero rows, so it takes no
 * lock, and two concurrent requests could each write a *different* member
 * row. That write skew is what SSI's predicate locks catch. The index now
 * makes it impossible regardless, so `Serializable` + retry is defence in
 * depth: the concurrent loser usually aborts with `P2034`, retries, and takes
 * the pre-check's branch instead of relying on the `P2002` mapping. Dropping
 * it would be safe, but it would change behaviour on the onboarding path for
 * no user-visible gain. A new membership-creating callsite should still go
 * through here, but it no longer reopens the hole if it does not — it only
 * has to map `P2002` itself.
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
