import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { RATE_LIMIT_BYPASS_ACTIVE } from '@/lib/rate-limit'

/**
 * Test-only back-channel for E2E specs that need to observe or nudge database
 * state Playwright cannot reach through the UI (HON-479):
 *
 * - `GET  ?action=reset-token&email=` — the pending password-reset token, so
 *   the forgot-password spec can complete the round-trip in environments where
 *   no mail provider is configured (tier 1 CI has no `RESEND_API_KEY`, so no
 *   email is ever sent).
 * - `GET  ?action=user-state&email=` — soft-delete columns, the user's
 *   household ids, and related row counts, for the account-deletion spec's
 *   grace-window assertions.
 * - `GET  ?action=household-state&householdId=` — whether a household and its
 *   scoped rows survived. Needed *after* a purge, when the user row is gone
 *   and `user-state` can no longer reach them.
 * - `POST ?action=expire-purge&email=` — back-dates `purgeScheduledFor` so the
 *   purge cron treats the 30-day window as elapsed. This keeps the production
 *   cron route (`/api/cron/purge-deleted-users`) free of test-only branches:
 *   the spec still calls it for real, with a real `CRON_SECRET`.
 *
 * Gated on `RATE_LIMIT_BYPASS_ACTIVE`, exactly like the sibling
 * `/api/e2e-seed`: that flag only turns on when `E2E_DISABLE_RATE_LIMIT=1` AND
 * `NEXT_PUBLIC_APP_ENV` is one of `ci` / `test` / `dev` (see
 * `src/lib/rate-limit.ts`, which throws at module init if the pair is set
 * anywhere else). Production / staging / preview therefore get a 404 — the
 * same shape `/api/e2e-seed` returns, so the route does not advertise itself.
 *
 * Consequence for `@smoke` specs: this route is unavailable on the shared
 * tiers, same as `/api/e2e-seed` (HON-560). A `@smoke` spec may only reach for
 * it as a fallback that degrades to `test.skip`, never as its primary path.
 *
 * Why HTTP rather than importing Prisma into the spec: the generated client is
 * bundled for Next.js and does not import cleanly in Playwright's plain-Node
 * runtime — same reasoning as `tests/e2e/utils/db-helpers.ts`.
 */

/** Better Auth prefixes password-reset verification rows with this. */
const RESET_TOKEN_PREFIX = 'reset-password:'

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

function missingParam(name: string) {
  return NextResponse.json({ error: `Missing ?${name}=<value>` }, { status: 400 })
}

function unknownAction(action: string | null) {
  return NextResponse.json({ error: `Unknown action: ${action ?? '<missing>'}` }, { status: 400 })
}

function param(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)
  return value && value.trim() ? value.trim() : null
}

async function resetToken(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Better Auth stores the reset token in the identifier
  // (`reset-password:<token>`) and the user id in the value — see
  // `node_modules/better-auth/dist/api/routes/password.mjs`. There is no index
  // on `value`, but this table is tiny in a test database.
  const verification = await prisma.verification.findFirst({
    where: {
      value: user.id,
      identifier: { startsWith: RESET_TOKEN_PREFIX },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: { identifier: true, expiresAt: true },
  })

  if (!verification) {
    return NextResponse.json({ error: 'No pending reset token' }, { status: 404 })
  }

  const token = verification.identifier.slice(RESET_TOKEN_PREFIX.length)

  return NextResponse.json({
    token,
    // The same link Better Auth puts in the email: hitting it validates the
    // token and redirects to /reset-password?token=…, so the spec exercises
    // the real callback rather than deep-linking past it.
    resetPath: `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent('/reset-password')}`,
    expiresAt: verification.expiresAt,
  })
}

async function userState(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true, purgeScheduledFor: true },
  })

  if (!user) {
    return NextResponse.json({ exists: false })
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

  return NextResponse.json({
    exists: true,
    deletedAt: user.deletedAt,
    purgeScheduledFor: user.purgeScheduledFor,
    householdIds,
    sessions,
    memberships: memberships.length,
    households,
    pantryItems,
    mealPlans,
  })
}

async function householdState(householdId: string) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { id: true },
  })

  if (!household) {
    return NextResponse.json({ exists: false, members: 0, pantryItems: 0, mealPlans: 0 })
  }

  const [members, pantryItems, mealPlans] = await Promise.all([
    prisma.householdMember.count({ where: { householdId } }),
    prisma.pantryItem.count({ where: { householdId } }),
    prisma.mealPlan.count({ where: { householdId } }),
  ])

  return NextResponse.json({ exists: true, members, pantryItems, mealPlans })
}

export async function GET(request: Request) {
  if (!RATE_LIMIT_BYPASS_ACTIVE) {
    return notFound()
  }

  const url = new URL(request.url)
  const action = url.searchParams.get('action')

  if (action === 'household-state') {
    const householdId = param(url, 'householdId')
    return householdId ? householdState(householdId) : missingParam('householdId')
  }

  if (action === 'reset-token' || action === 'user-state') {
    const email = param(url, 'email')
    if (!email) {
      return missingParam('email')
    }
    return action === 'reset-token' ? resetToken(email) : userState(email)
  }

  return unknownAction(action)
}

export async function POST(request: Request) {
  if (!RATE_LIMIT_BYPASS_ACTIVE) {
    return notFound()
  }

  const url = new URL(request.url)
  const action = url.searchParams.get('action')

  if (action !== 'expire-purge') {
    return unknownAction(action)
  }

  const email = param(url, 'email')
  if (!email) {
    return missingParam('email')
  }

  // Only ever touches an account that has already requested deletion, so a
  // stray call can't schedule a live account for purge.
  const result = await prisma.user.updateMany({
    where: { email, deletedAt: { not: null } },
    data: { purgeScheduledFor: new Date(Date.now() - 60_000) },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'No soft-deleted user with that email' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, updated: result.count })
}
