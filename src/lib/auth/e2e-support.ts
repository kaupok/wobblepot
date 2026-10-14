import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * The reads and writes behind the test-only `/api/e2e-support` route
 * (HON-479, HON-1216). The route owns the gate, the parameters, the Better
 * Auth link minting and the status map; this module owns every query, and is
 * tested against a database in `e2e-support.db.test.ts`.
 */

/** Better Auth prefixes password-reset verification rows with this. */
const RESET_TOKEN_PREFIX = 'reset-password:'

/**
 * Why a request was refused. The route maps each one to its status:
 *
 * - `userNotFound`: no user has that email (404).
 * - `noResetToken`: the user has no unexpired password-reset token (404).
 * - `alreadyVerified`: the email is verified already, so there is no link to mint (409).
 * - `noSoftDeletedUser`: no user with that email has requested deletion (404).
 */
export type E2eSupportRefusal =
  'userNotFound' | 'noResetToken' | 'alreadyVerified' | 'noSoftDeletedUser'

export class E2eSupportError extends Error {
  constructor(readonly reason: E2eSupportRefusal) {
    super(`E2E support request refused: ${reason}`)
    this.name = 'E2eSupportError'
  }
}

/** The user's newest unexpired password-reset token, without its prefix. */
export async function findPendingResetToken(
  email: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) throw new E2eSupportError('userNotFound')

  // Better Auth stores the reset token in the identifier
  // (`reset-password:<token>`) and the user id in the value — see
  // `node_modules/better-auth/dist/api/routes/password.mjs`. There is no index
  // on `value`, but this table is tiny in a test database.
  const verification = await prisma.verification.findFirst({
    where: {
      value: user.id,
      identifier: { startsWith: RESET_TOKEN_PREFIX },
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
    select: { identifier: true, expiresAt: true },
  })
  if (!verification) throw new E2eSupportError('noResetToken')

  return {
    token: verification.identifier.slice(RESET_TOKEN_PREFIX.length),
    expiresAt: verification.expiresAt,
  }
}

/** Passes only for an account whose email still needs verifying. */
export async function assertEmailUnverified(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { emailVerified: true } })
  if (!user) throw new E2eSupportError('userNotFound')
  if (user.emailVerified) throw new E2eSupportError('alreadyVerified')
}

/**
 * `emailVerified`, the soft-delete columns, the user's household ids, and
 * related row counts, for the account-deletion spec's grace-window assertions.
 * A purged account is a bare `{ exists: false }`.
 */
export async function readUserState(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true, deletedAt: true, purgeScheduledFor: true },
  })

  if (!user) {
    return { exists: false as const }
  }

  const memberships = await prisma.householdMember.findMany({
    where: { userId: user.id },
    select: { householdId: true },
  })
  const householdIds = memberships.map((m) => m.householdId)

  const [sessions, households, pantryItems, mealPlans] = await Promise.all([
    prisma.session.count({ where: { userId: user.id } }),
    householdIds.length
      ? prisma.household.count({ where: { id: { in: householdIds } } })
      : Promise.resolve(0),
    householdIds.length
      ? prisma.pantryItem.count({ where: { householdId: { in: householdIds } } })
      : Promise.resolve(0),
    householdIds.length
      ? prisma.mealPlan.count({ where: { householdId: { in: householdIds } } })
      : Promise.resolve(0),
  ])

  return {
    exists: true as const,
    emailVerified: user.emailVerified,
    deletedAt: user.deletedAt,
    purgeScheduledFor: user.purgeScheduledFor,
    householdIds,
    sessions,
    memberships: memberships.length,
    households,
    pantryItems,
    mealPlans,
  }
}

/**
 * Whether a household and its scoped rows survived. Needed after a purge,
 * when the user row is gone and `readUserState` can no longer reach them.
 */
export async function readHouseholdState(householdId: string) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { id: true },
  })

  if (!household) {
    // Bare shape on purpose, matching readUserState: fabricated zero counts
    // read as measurements and let specs assert constants without noticing.
    return { exists: false as const }
  }

  const [members, pantryItems, mealPlans] = await Promise.all([
    prisma.householdMember.count({ where: { householdId } }),
    prisma.pantryItem.count({ where: { householdId } }),
    prisma.mealPlan.count({ where: { householdId } }),
  ])

  return { exists: true as const, members, pantryItems, mealPlans }
}

/**
 * Back-dates `purgeScheduledFor` to a minute before `now`, so the purge cron
 * treats the 30-day window as elapsed. Returns how many rows changed.
 */
export async function expirePurge(email: string, now: Date = new Date()): Promise<number> {
  // Only ever touches an account that has already requested deletion, so a
  // stray call can't schedule a live account for purge.
  const { count } = await prisma.user.updateMany({
    where: { email, deletedAt: { not: null } },
    data: { purgeScheduledFor: new Date(now.getTime() - 60_000) },
  })
  if (count === 0) throw new E2eSupportError('noSoftDeletedUser')
  return count
}
