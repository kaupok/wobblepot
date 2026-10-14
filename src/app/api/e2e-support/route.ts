import { NextResponse } from 'next/server'
import { createEmailVerificationToken } from 'better-auth/api'
import { auth } from '@/lib/auth'
import {
  EMAIL_VERIFICATION_CALLBACK_URL,
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
} from '@/lib/email-verification'
import {
  assertEmailUnverified,
  E2eSupportError,
  expirePurge,
  findPendingResetToken,
  readHouseholdState,
  readUserState,
  type E2eSupportRefusal,
} from '@/lib/auth/e2e-support'
import { captureApiError } from '@/lib/errors'
import { RATE_LIMIT_BYPASS_ACTIVE } from '@/lib/rate-limit'

/**
 * Test-only back-channel for E2E specs that need to observe or nudge database
 * state Playwright cannot reach through the UI (HON-479):
 *
 * - `GET  ?action=reset-token&email=` — the pending password-reset token, so
 *   the forgot-password spec can complete the round-trip in environments where
 *   no mail provider is configured (tier 1 CI has no `RESEND_API_KEY`, so no
 *   email is ever sent).
 * - `GET  ?action=user-state&email=` — `emailVerified`, the soft-delete
 *   columns, the user's household ids, and related row counts, for the
 *   account-deletion spec's grace-window assertions.
 * - `GET  ?action=verify-email-link&email=` — a verification link for an
 *   unverified account, the same link the sign-up mail carries (HON-1155).
 *   Better Auth's verification token is a signed JWT, not a `verification`
 *   row, so there is nothing to read: the route mints one with Better Auth's
 *   own function and secret. `&expired=1` mints one that has already expired,
 *   for the expired-link path.
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
 *
 * The queries live in `@/lib/auth/e2e-support` (HON-1216); this route owns
 * the gate, the parameters, the Better Auth link minting and the status map.
 */

const REFUSALS: Record<E2eSupportRefusal, { status: number; error: string }> = {
  userNotFound: { status: 404, error: 'User not found' },
  noResetToken: { status: 404, error: 'No pending reset token' },
  alreadyVerified: { status: 409, error: 'Email already verified' },
  noSoftDeletedUser: { status: 404, error: 'No soft-deleted user with that email' },
}

function refused(error: E2eSupportError) {
  const { status, error: message } = REFUSALS[error.reason]
  return NextResponse.json({ error: message }, { status })
}

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
  const { token, expiresAt } = await findPendingResetToken(email)

  return NextResponse.json({
    token,
    // The same link Better Auth puts in the email: hitting it validates the
    // token and redirects to /reset-password?token=…, so the spec exercises
    // the real callback rather than deep-linking past it.
    resetPath: `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent('/reset-password')}`,
    expiresAt,
  })
}

async function verifyEmailLink(email: string, expired: boolean) {
  await assertEmailUnverified(email)

  // `$context.secret` is the secret Better Auth signs with, which follows
  // `BETTER_AUTH_SECRETS` rotation; `serverEnv.BETTER_AUTH_SECRET` would not.
  const { secret } = await auth.$context
  // A negative lifetime sets `exp` in the past, so Better Auth's verify-email
  // answers with its real `TOKEN_EXPIRED` redirect.
  const token = await createEmailVerificationToken(
    secret,
    email,
    undefined,
    expired ? -60 : EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  )

  return NextResponse.json({
    // The path Better Auth puts in the mail: hitting it sets the flag and
    // redirects to the callback, so the spec exercises the real endpoint.
    verifyPath: `/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent(EMAIL_VERIFICATION_CALLBACK_URL)}`,
  })
}

export async function GET(request: Request) {
  if (!RATE_LIMIT_BYPASS_ACTIVE) {
    return notFound()
  }

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')

    if (action === 'household-state') {
      const householdId = param(url, 'householdId')
      // `await` matters: a promise that settles outside this try/catch would
      // let a query failure bypass the { error } contract.
      return householdId
        ? NextResponse.json(await readHouseholdState(householdId))
        : missingParam('householdId')
    }

    if (action === 'reset-token' || action === 'user-state' || action === 'verify-email-link') {
      const email = param(url, 'email')
      if (!email) {
        return missingParam('email')
      }
      if (action === 'reset-token') return await resetToken(email)
      if (action === 'verify-email-link') {
        return await verifyEmailLink(email, url.searchParams.get('expired') === '1')
      }
      return NextResponse.json(await readUserState(email))
    }

    return unknownAction(action)
  } catch (error) {
    if (error instanceof E2eSupportError) return refused(error)
    captureApiError(error, { route: '/api/e2e-support' })
    return NextResponse.json({ error: 'Failed to read E2E support state' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!RATE_LIMIT_BYPASS_ACTIVE) {
    return notFound()
  }

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')

    if (action !== 'expire-purge') {
      return unknownAction(action)
    }

    const email = param(url, 'email')
    if (!email) {
      return missingParam('email')
    }

    const updated = await expirePurge(email)

    return NextResponse.json({ ok: true, updated })
  } catch (error) {
    if (error instanceof E2eSupportError) return refused(error)
    captureApiError(error, { route: '/api/e2e-support' })
    return NextResponse.json({ error: 'Failed to update E2E support state' }, { status: 500 })
  }
}
