import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { hashPassword } from 'better-auth/crypto'
import { prismaAdapter } from '@better-auth/prisma-adapter'
import { prisma, type PrismaClientType } from '@/lib/prisma'
import { serverEnv, getServerBaseURL } from '@/lib/env'
import { resend, isEmailConfigured, EMAIL_SENDERS, envSubject } from '@/lib/resend'
import { generateResetPasswordEmail } from '@/lib/emails/reset-password'
import { isPasswordBreached } from '@/lib/breached-password'
import { RATE_LIMIT_BYPASS_ACTIVE } from '@/lib/rate-limit'
import { linkUsedBy, releaseClaim, validateAndClaimInviteCode } from '@/lib/signup-codes'
import { assertUserNotSoftDeleted } from '@/lib/auth/soft-delete-guard'
import { CURRENT_TERMS_VERSION } from '@/lib/consent'

const MIN_PASSWORD_LENGTH = 12

export const TERMS_NOT_ACCEPTED_MESSAGE =
  'You must accept the Terms of Service and Privacy Policy to create an account.'

/**
 * Server-side gate for the sign-up consent checkbox (HON-457, GDPR Art. 13).
 * The client sends `acceptedTerms: true` alongside the credentials; anything
 * else — missing, false, truthy non-boolean — is rejected so a bypassed or
 * regressed client cannot create an account without recorded consent.
 * Exported for unit testing, like {@link hashPasswordWithBreachCheck}.
 */
export function assertTermsAccepted(body: unknown): void {
  const accepted =
    typeof body === 'object' && body !== null
      ? (body as { acceptedTerms?: unknown }).acceptedTerms
      : undefined
  if (accepted !== true) {
    throw new APIError('BAD_REQUEST', {
      message: TERMS_NOT_ACCEPTED_MESSAGE,
      code: 'TERMS_NOT_ACCEPTED',
    })
  }
}

/**
 * Consent stamp merged into the user row at creation (HON-457). Values are
 * produced server-side — `acceptedTermsVersion` mirrors CURRENT_TERMS_VERSION
 * at the moment of sign-up, and both fields are `input: false` in
 * `additionalFields`, so clients can never supply them.
 *
 * `path` guard: `databaseHooks.user.create.before` fires for *every* user
 * creation. Consent validation lives only on the email sign-up path
 * (`hooks.before` above), so we stamp only when the creating request is
 * `/sign-up/email`. A future OAuth flow (or admin/internal creation, where
 * `path` is undefined) must capture consent on its own surface — do NOT
 * widen this guard without adding that surface's consent checkbox first.
 */
export function stampTermsConsent(path: string | undefined, now: Date = new Date()) {
  if (path !== '/sign-up/email') return null
  return {
    acceptedTermsAt: now,
    acceptedTermsVersion: CURRENT_TERMS_VERSION,
  }
}

const BREACHED_PASSWORD_MESSAGE =
  'That password appears in known data breaches. Please pick a different one.'

/**
 * Wraps Better Auth's default scrypt with an HIBP breach check. Exported
 * so it can be unit-tested in isolation and so a wiring assertion can
 * verify it is actually used by `emailAndPassword.password.hash`.
 */
export async function hashPasswordWithBreachCheck(password: string): Promise<string> {
  if (await isPasswordBreached(password)) {
    throw new APIError('BAD_REQUEST', {
      message: BREACHED_PASSWORD_MESSAGE,
      code: 'PASSWORD_COMPROMISED',
    })
  }
  return hashPassword(password)
}

/**
 * Creates a household for a new user with default preferences
 * Called after user signup to set up their initial household
 */
export async function createHouseholdForUser(
  userId: string,
  userName: string,
  db: PrismaClientType = prisma,
) {
  await db.$transaction(async (tx) => {
    const household = await tx.household.create({
      data: {
        name: `${userName}'s Household`,
      },
    })

    await tx.householdMember.create({
      data: {
        householdId: household.id,
        userId: userId,
        role: 'owner',
      },
    })

    await tx.householdPreferences.create({
      data: {
        householdId: household.id,
        // Uses schema defaults: weekdayMealTypes: [dinner], weekendMealTypes: [dinner]
      },
    })
  })
}

/**
 * Better Auth configuration
 *
 * This is the main server-side authentication instance. It handles:
 * - Email/password authentication
 * - Session management
 * - CSRF protection via trustedOrigins
 *
 * @see https://www.better-auth.com/docs
 */
export const auth = betterAuth({
  /**
   * Database configuration
   * Using Prisma adapter with Neon PostgreSQL
   */
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  /**
   * Secret key for encryption and signing
   * Automatically loaded from BETTER_AUTH_SECRET environment variable
   */
  secret: serverEnv.BETTER_AUTH_SECRET,

  /**
   * Base URL for the application
   * Used for generating absolute URLs and CSRF protection
   */
  baseURL: getServerBaseURL(),

  /**
   * Trusted origins for CSRF protection
   * Requests from origins not in this list will be blocked
   */
  trustedOrigins: [getServerBaseURL()],

  /**
   * Better Auth ships its own in-memory IP rate limiter (default 3 sign-ups
   * or sign-ins per 10 s per IP, on by default in production). It runs in
   * addition to the Upstash limiter wired into
   * `src/app/api/auth/[...all]/route.ts`. In CI, the Upstash limiter
   * bypasses cleanly via `E2E_DISABLE_RATE_LIMIT`, but Next.js's `next start`
   * reports as production-mode to Better Auth, so the built-in limiter
   * stays on and trips the 4th sign-up within 10 s — the original symptom
   * tracked as HON-520. Disable both together when our bypass is active.
   * In production both limiters stay on; the Upstash one is the load-bearing
   * one (memory storage doesn't survive serverless instance churn anyway).
   */
  rateLimit: RATE_LIMIT_BYPASS_ACTIVE ? { enabled: false } : undefined,

  /**
   * Email and password authentication configuration
   */
  emailAndPassword: {
    enabled: true,
    /**
     * Automatically sign in users after successful registration
     */
    autoSignIn: true,
    /**
     * Stricter than the Better Auth default of 8 — see HON-464.
     * Existing users with shorter passwords are unaffected: the
     * minimum is enforced at sign-up and password reset only.
     */
    minPasswordLength: MIN_PASSWORD_LENGTH,
    /**
     * HIBP breach check before storing a new password.
     * `hash` is only invoked when storing a new password (sign-up, reset,
     * change), so existing users with shorter or known-breached passwords
     * keep working — `verify` still uses the default scrypt path.
     */
    password: {
      hash: hashPasswordWithBreachCheck,
    },
    /**
     * Password reset email handler
     * Sends email via Resend. Errors are logged but not thrown
     * to prevent account enumeration attacks.
     */
    sendResetPassword: async ({ user, url }) => {
      if (!isEmailConfigured() || !resend) {
        // eslint-disable-next-line no-console
        console.warn('Email not configured. Password reset email not sent.')
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.log('Reset URL:', url)
        }
        return
      }

      const { subject, ...rest } = generateResetPasswordEmail({ resetUrl: url })

      try {
        await resend.emails.send({
          from: EMAIL_SENDERS.auth,
          to: user.email,
          subject: envSubject(subject),
          ...rest,
        })
      } catch (error) {
        // Don't throw - prevents account enumeration via timing/error differences.
        // eslint-disable-next-line no-console
        console.error('Failed to send password reset email:', error)
      }
    },
  },

  /**
   * Schema extension for the consent columns (HON-457). `input: false` means
   * the values can never come from the request body — they are stamped
   * server-side in `databaseHooks.user.create.before` below. Declaring them
   * here teaches the adapter the columns so they round-trip on reads.
   */
  user: {
    additionalFields: {
      acceptedTermsAt: { type: 'date', required: false, input: false },
      acceptedTermsVersion: { type: 'number', required: false, input: false },
    },
  },

  /**
   * Database lifecycle hooks. Blocks session creation for soft-deleted accounts
   * (GDPR Art. 17 grace window — HON-481): when a user has requested deletion
   * (`deletedAt` set), `assertUserNotSoftDeleted` throws a generic credential
   * error, so sign-in fails identically to a wrong password and the deletion
   * state never leaks. This runs after credentials are verified, so it adds no
   * read to failed sign-ins. Recovery clears `deletedAt` (see the GDPR-deletion
   * runbook), after which sign-in works again.
   */
  databaseHooks: {
    user: {
      create: {
        /**
         * Stamps `acceptedTermsAt` + `acceptedTermsVersion` on the new user
         * row (HON-457). See {@link stampTermsConsent} for the path guard —
         * only email sign-up carries validated consent today.
         */
        before: async (user, ctx) => {
          const consent = stampTermsConsent(ctx?.path)
          if (!consent) return
          return { data: { ...user, ...consent } }
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          await assertUserNotSoftDeleted(session.userId)
        },
      },
    },
  },

  /**
   * Invite-only sign-up gate. The `before` hook validates the invite code
   * (gated by the `invite_code_required` PostHog kill-switch) and atomically
   * claims it via a row-level UPDATE; the `after` hook backfills the
   * `usedById` link once the new user row exists. Both delegate to
   * `src/lib/signup-codes.ts` so the validation/claim logic stays
   * unit-testable in isolation. See HON-488.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return
      // Terms consent first: rejecting here means the invite code below is
      // never claimed, so a consent failure can't burn a code (HON-457).
      assertTermsAccepted(ctx.body)
      await validateAndClaimInviteCode(ctx.body)
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return
      const userId = ctx.context.newSession?.user?.id
      if (userId) {
        await linkUsedBy(ctx.body, userId)
        return
      }
      // Sign-up failed after the atomic claim — Better Auth's endpoint runs
      // *after* hooks.before, so a Zod validation, USER_ALREADY_EXISTS, or
      // breached-password rejection at the endpoint layer leaves the code
      // claimed but unlinked. Release it so the user can retry without
      // burning the code permanently.
      await releaseClaim(ctx.body)
    }),
  },
})

/**
 * Infer the session type from Better Auth
 */
export type Session = typeof auth.$Infer.Session
