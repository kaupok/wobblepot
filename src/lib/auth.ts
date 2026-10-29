import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { mcp } from '@better-auth/mcp'
import { prismaAdapter } from '@better-auth/prisma-adapter'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { hashPassword } from 'better-auth/crypto'
import { jwt } from 'better-auth/plugins'

import { MAX_ACCOUNT_NAME_LENGTH } from '@/lib/account-name'
import { afterAccountEmailChange, readChangeEmailToken } from '@/lib/auth/change-email'
import { assertUserNotSoftDeleted } from '@/lib/auth/soft-delete-guard'
import { isPasswordBreached } from '@/lib/breached-password'
import { CURRENT_TERMS_VERSION } from '@/lib/consent'
import { EMAIL_VERIFICATION_EXPIRES_IN_SECONDS } from '@/lib/email-verification'
import { generateChangeEmailEmail } from '@/lib/emails/change-email'
import { resolveEmailLocale } from '@/lib/emails/locale'
import { generateResetPasswordEmail } from '@/lib/emails/reset-password'
import { generateVerifyEmailEmail } from '@/lib/emails/verify-email'
import { getServerBaseURL, isGoogleAuthConfigured, serverEnv } from '@/lib/env'
import { getHouseholdInviteCodeFromBody, joinHouseholdFromSignUp } from '@/lib/household-invite'
import { matchAcceptLanguage } from '@/lib/i18n/accept-language'
import { DEFAULT_LOCALE, isPublicLocale } from '@/lib/i18n/locales'
import { captureMcpClientConnected } from '@/lib/mcp/consent-analytics'
import { getMcpIssuer, getMcpResource, MCP_SCOPES } from '@/lib/mcp/oauth'
import { getPosthogServer } from '@/lib/posthog-server'
import { prisma } from '@/lib/prisma'
import { RATE_LIMIT_BYPASS_ACTIVE } from '@/lib/rate-limit'
import { EMAIL_SENDERS, envSubject, isEmailConfigured, resend } from '@/lib/resend'
import {
  claimInviteCode,
  getInviteCodeFromBody,
  HOUSEHOLD_INVITE_INVALID_MESSAGE,
  INVITE_CODE_INVALID_MESSAGE,
  linkUsedBy,
  releaseClaim,
  validateAndClaimInviteCode,
  validateInviteCode,
} from '@/lib/signup-codes'
import { timeSignupStep } from '@/lib/signup-timing'
import { clearWaitlistForNewUser } from '@/lib/waitlist'

const MIN_PASSWORD_LENGTH = 12
// Better Auth's default, set here because `errors.auth.passwordTooLong` names
// the number. The inputs carry no `maxLength`: the browser would cut a pasted
// longer password silently, and sign-in, which has no cap, would then reject it.
const MAX_PASSWORD_LENGTH = 128

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

export const INVALID_ACCOUNT_NAME_MESSAGE = `The account name must be 1 to ${MAX_ACCOUNT_NAME_LENGTH} characters.`

/**
 * Server-side gate for `/update-user` (HON-1129). The profile form trims the
 * name and caps it at {@link MAX_ACCOUNT_NAME_LENGTH}; this rejects a request
 * that skips the form, including a blank name. A body without `name` (an image-only update) passes.
 * Exported for unit testing, like {@link assertTermsAccepted}.
 */
export function assertValidAccountNameUpdate(body: unknown): void {
  if (typeof body !== 'object' || body === null || !('name' in body)) return
  const name = (body as { name?: unknown }).name
  if (name === undefined) return
  // The raw length, not the trimmed one: Better Auth stores `name` as sent, so
  // padding must not slip a long value past the limit.
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_ACCOUNT_NAME_LENGTH) {
    throw new APIError('BAD_REQUEST', {
      message: INVALID_ACCOUNT_NAME_MESSAGE,
      code: 'INVALID_ACCOUNT_NAME',
    })
  }
}

/** Better Auth's route for every social provider's redirect back to us. */
export const OAUTH_CALLBACK_PATH = '/callback/:id'

/**
 * True when the OAuth state of a callback comes from the sign-up page's Google
 * button (HON-1157): it asked for sign-up and carried the consent flag. The
 * state is signed by Better Auth, and `beforeSocialSignIn` checked both values
 * before the redirect, so a client cannot add them afterwards.
 */
export function isOAuthSignUpState(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false
  const { requestSignUp, acceptedTerms } = state as {
    requestSignUp?: unknown
    acceptedTerms?: unknown
  }
  return requestSignUp === true && acceptedTerms === true
}

/**
 * Consent stamp merged into the user row at creation (HON-457). Values are
 * produced server-side — `acceptedTermsVersion` mirrors CURRENT_TERMS_VERSION
 * at the moment of sign-up, and both fields are `input: false` in
 * `additionalFields`, so clients can never supply them.
 *
 * `path` guard: `databaseHooks.user.create.before` fires for *every* user
 * creation. Consent is validated on two surfaces only, so only they stamp:
 * `/sign-up/email` (`hooks.before` checks the checkbox), and the Google
 * callback when its OAuth `state` carries the sign-up page's consent
 * (`beforeSocialSignIn` checked it before the redirect, HON-1157). Any other
 * creation (admin/internal, where `path` is undefined) gets no stamp — do NOT
 * widen this guard without adding that surface's consent checkbox first.
 */
export function stampTermsConsent(
  path: string | undefined,
  now: Date = new Date(),
  state?: unknown,
) {
  const consented =
    path === '/sign-up/email' || (path === OAUTH_CALLBACK_PATH && isOAuthSignUpState(state))
  if (!consented) return null
  return {
    acceptedTermsAt: now,
    acceptedTermsVersion: CURRENT_TERMS_VERSION,
  }
}

export const GOOGLE_EMAIL_NOT_VERIFIED_MESSAGE = 'Google has not verified this email address.'

/**
 * Gate for a user row that an OAuth callback is about to create (HON-1157).
 * Returns the consent stamp, or throws so no row is written:
 *
 * - no sign-up consent in the state: with `disableImplicitSignUp` Better Auth
 *   only creates a user for a `requestSignUp` flow, which the sign-up page
 *   starts with consent, so this is a bypass or a regression;
 * - Google did not verify the address: the provider's
 *   `requireEmailVerification` refuses the session only after the insert, which
 *   would leave a row nobody can sign in to.
 *
 * The callback turns the thrown code into `?error=<code>` on the error URL.
 */
export function assertOAuthUserCreation(
  user: { emailVerified?: unknown },
  state: unknown,
  now: Date = new Date(),
) {
  const consent = stampTermsConsent(OAUTH_CALLBACK_PATH, now, state)
  if (!consent) {
    throw new APIError('BAD_REQUEST', {
      message: TERMS_NOT_ACCEPTED_MESSAGE,
      code: 'TERMS_NOT_ACCEPTED',
    })
  }
  if (user.emailVerified !== true) {
    throw new APIError('FORBIDDEN', {
      message: GOOGLE_EMAIL_NOT_VERIFIED_MESSAGE,
      code: 'email_not_verified',
    })
  }
  return consent
}

export const ID_TOKEN_SIGN_IN_MESSAGE = 'Sign-in with an ID token is not supported.'

/** `additionalData` off a `/sign-in/social` body: client-supplied, not trusted. */
function getAdditionalData(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined
  return (body as { additionalData?: unknown }).additionalData
}

/**
 * The `/sign-in/social` before-hook (HON-1157), exported for unit testing.
 *
 * - `idToken` is refused. The app never sends one, and that branch creates the
 *   user inside this request, past the callback where the invite code is
 *   claimed and the waitlist cleared.
 * - A plain sign-in (no `requestSignUp`) passes: `disableImplicitSignUp` means
 *   it can only reach an existing account.
 * - A sign-up must carry consent and a valid code (or household invite) in
 *   `additionalData`, checked here so a refusal comes before the redirect to
 *   Google. The code is validated, not claimed: the user can abandon the flow
 *   at Google. {@link beforeOAuthUserCreate} claims it once Google returns.
 *
 * `getOAuthState()` is still empty here: Better Auth builds the state inside
 * the endpoint, from this same `additionalData`.
 */
export async function beforeSocialSignIn(body: unknown): Promise<void> {
  if (typeof body !== 'object' || body === null) return
  const { idToken, requestSignUp } = body as { idToken?: unknown; requestSignUp?: unknown }
  if (idToken !== undefined) {
    throw new APIError('BAD_REQUEST', {
      message: ID_TOKEN_SIGN_IN_MESSAGE,
      code: 'ID_TOKEN_NOT_SUPPORTED',
    })
  }
  if (requestSignUp !== true) return
  const data = getAdditionalData(body)
  assertTermsAccepted(data)
  await validateInviteCode(data)
}

/**
 * OAuth states whose callback is creating a user. Better Auth keeps one state
 * object per request (`getOAuthState()` returns the same reference in the
 * create hook and in `hooks.after`), so membership says exactly "this callback
 * created the user", which Better Auth's own `isRegister` does not expose.
 */
const statesCreatingUser = new WeakSet<object>()

/**
 * The OAuth callback's create hook (HON-1157), exported for unit testing.
 * Runs only when Better Auth is about to insert a user, so only for a real
 * sign-up:
 *
 * - {@link assertOAuthUserCreation}: consent in the state, a verified address;
 * - check the household invite again, if the state carries one;
 * - claim the invite code, atomically, before the insert. `/sign-in/social`
 *   only validated it, and the state lives 10 minutes, so several flows can
 *   start on one code; the first to come back claims it, and the rest are
 *   refused (`?error=INVITE_CODE_INVALID`) with no row written. The email path
 *   has the same one-account-per-code rule;
 * - mark the state, so the after-hook does the rest of the sign-up.
 *
 * Returns the consent stamp to merge into the row.
 */
export async function beforeOAuthUserCreate(
  user: { emailVerified?: unknown },
  state: unknown,
  now: Date = new Date(),
) {
  const consent = assertOAuthUserCreation(user, state, now)
  // A household invite stands in for the code (HON-1131). Nothing claims it
  // before the after-hook joins it, so check again that it still admits a
  // sign-up: a link used or revoked while the visitor was at Google writes no
  // row. Two callbacks within milliseconds can both pass, as on the email path.
  if (getHouseholdInviteCodeFromBody(state)) {
    try {
      await validateInviteCode(state)
    } catch {
      throw new APIError('FORBIDDEN', {
        message: HOUSEHOLD_INVITE_INVALID_MESSAGE,
        code: 'HOUSEHOLD_INVITE_INVALID',
      })
    }
  }
  if (getInviteCodeFromBody(state) && !(await claimInviteCode(state))) {
    throw new APIError('FORBIDDEN', {
      message: INVITE_CODE_INVALID_MESSAGE,
      code: 'INVITE_CODE_INVALID',
    })
  }
  if (typeof state === 'object' && state !== null) statesCreatingUser.add(state)
  return consent
}

/**
 * The `/callback/:id` after-hook (HON-1157), exported for unit testing.
 * Nothing to do unless this callback's create hook ran. Then, with a session,
 * finish the sign-up ({@link afterOAuthSignUp}); without one the sign-up
 * failed after the claim, so release the code, as the email path does.
 */
export async function afterOAuthCallback(state: unknown, userId: string | undefined) {
  if (typeof state !== 'object' || state === null || !statesCreatingUser.has(state)) return
  statesCreatingUser.delete(state)
  if (userId) {
    await afterOAuthSignUp(state, userId)
    return
  }
  await releaseClaim(state)
}

/**
 * A new Google user's sign-up, after the row exists (HON-1157). The same steps
 * as {@link afterEmailSignUp}, with the OAuth state as the body: link the code
 * the create hook claimed, clear the waitlist request, join the household
 * invite. Then capture `auth:sign_up` with `method: 'google'`: the browser
 * left for Google and came back on a redirect, so it has no success callback
 * to `track()` from. No step throws: the user and their session exist.
 */
export async function afterOAuthSignUp(state: unknown, userId: string): Promise<void> {
  await linkUsedBy(state, userId)
  await clearWaitlistForNewUser(userId)
  await joinHouseholdFromSignUp(state, userId)
  try {
    getPosthogServer()?.capture({
      distinctId: userId,
      event: 'auth:sign_up',
      properties: { method: 'google' },
    })
  } catch {
    // Analytics only.
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
  if (await timeSignupStep('hibp', () => isPasswordBreached(password))) {
    throw new APIError('BAD_REQUEST', {
      message: BREACHED_PASSWORD_MESSAGE,
      code: 'PASSWORD_COMPROMISED',
    })
  }
  return timeSignupStep('scrypt', () => hashPassword(password))
}

/**
 * The `/sign-up/email` after-hook body, exported for unit testing.
 *
 * On success it links the used invite code, then deletes the new user's
 * waitlist request by email. The second step runs with or without a code,
 * because with `invite_code_required` off a waitlisted address signs up with
 * none (HON-1102). When the sign-up came from a household invite link, it then
 * puts the user into the invite's member row (HON-1131). No step throws.
 *
 * On failure (no user) the sign-up failed after the atomic claim: Better
 * Auth's endpoint runs *after* hooks.before, so a Zod validation,
 * USER_ALREADY_EXISTS, or breached-password rejection at the endpoint layer
 * leaves the code claimed but unlinked. Release it so the user can retry
 * without burning the code permanently.
 */
export async function afterEmailSignUp(body: unknown, userId: string | undefined): Promise<void> {
  if (userId) {
    await linkUsedBy(body, userId)
    await clearWaitlistForNewUser(userId)
    await joinHouseholdFromSignUp(body, userId)
    return
  }
  await releaseClaim(body)
}

/**
 * Sends the account verification mail (HON-1155): on sign-up, and on Resend
 * from `/account`. Exported for unit testing; wired into
 * `emailVerification.sendVerificationEmail` below.
 *
 * The locale is the household's. A new account has no household yet, so the
 * fallback is the visitor's `Accept-Language`, limited to public locales.
 * Like `sendResetPassword`, it never throws: a failed send is logged, and
 * Resend on `/account` lets the user try again.
 */
export async function sendAccountVerificationEmail(
  { user, url, token }: { user: { id: string; email: string }; url: string; token?: string },
  request?: Request,
): Promise<void> {
  if (!isEmailConfigured() || !resend) {
    // eslint-disable-next-line no-console
    console.warn('Email not configured. Verification email not sent.')
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('Verification URL:', url)
    }
    return
  }

  const requested = matchAcceptLanguage(request?.headers.get('accept-language'))
  const fallback = requested && isPublicLocale(requested) ? requested : DEFAULT_LOCALE
  const locale = await resolveEmailLocale(user.id, fallback)
  // An email change sends its token here too, to the new address (HON-1137).
  const generate = readChangeEmailToken(token) ? generateChangeEmailEmail : generateVerifyEmailEmail
  const { subject, ...rest } = generate({ verifyUrl: url, locale })

  try {
    await resend.emails.send({
      from: EMAIL_SENDERS.auth,
      to: user.email,
      subject: envSubject(subject),
      ...rest,
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to send verification email:', error)
  }
}

/**
 * Better Auth configuration
 *
 * This is the main server-side authentication instance. It handles:
 * - Email/password authentication
 * - Google sign-in and sign-up, when `isGoogleAuthConfigured()` (HON-1157)
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
    maxPasswordLength: MAX_PASSWORD_LENGTH,
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

      // Household locale, validated against PUBLIC_LOCALES, falling back to
      // `en` for a user with no household (HON-513).
      const locale = await resolveEmailLocale(user.id)
      const { subject, ...rest } = generateResetPasswordEmail({ resetUrl: url, locale })

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
   * Google sign-in (HON-1157), registered only when both env vars are set, so
   * dev, CI and previews without them run email/password only.
   *
   * - `disableImplicitSignUp`: a Google account with no Wobblepot account is
   *   refused (`?error=signup_disabled`) unless the request asks for sign-up.
   *   Only the sign-up page's button does, after consent and the invite code,
   *   which `beforeSocialSignIn` checks again on the server.
   * - `requireEmailVerification`: Google must report the address verified.
   *   Account linking and sign-up both rely on the address being real.
   * - `image: undefined`: nothing renders `user.image`, and the CSP `img-src` does
   *   not allow Google's hosts, so the URL is not stored.
   *
   * `account.accountLinking` keeps Better Auth's defaults: Google links to a
   * password account on the same address only when that address is verified
   * locally (`requireLocalEmailVerified`). Do not add Google to
   * `trustedProviders` to skip that: a password account a stranger created on
   * your address must not become reachable through your Google sign-in.
   */
  socialProviders: isGoogleAuthConfigured()
    ? {
        google: {
          clientId: serverEnv.GOOGLE_CLIENT_ID!,
          clientSecret: serverEnv.GOOGLE_CLIENT_SECRET!,
          prompt: 'select_account',
          disableImplicitSignUp: true,
          requireEmailVerification: true,
          mapProfileToUser: (profile) => ({ name: profile.name, image: undefined }),
        },
      }
    : {},

  /**
   * Account email verification, in the soft form (HON-1155): sign-up sends a
   * link, and sign-in stays open before it is clicked, so
   * `emailAndPassword.requireEmailVerification` stays unset. The link lands on
   * `EMAIL_VERIFICATION_CALLBACK_URL` (`/account?verified=1`), which the sign-up
   * form and the Resend button send as `callbackURL`. No auto sign-in: the user
   * is normally signed in already, and `/account` sends an anonymous visitor
   * through sign-in and back.
   */
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
    sendVerificationEmail: (data, request) => sendAccountVerificationEmail(data, request),
  },

  /**
   * Schema extension for the consent columns (HON-457). `input: false` means
   * the values can never come from the request body — they are stamped
   * server-side in `databaseHooks.user.create.before` below. Declaring them
   * here teaches the adapter the columns so they round-trip on reads.
   */
  user: {
    // The new address gets a link; the change waits for it (HON-1137).
    changeEmail: { enabled: true },
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
         * row (HON-457). See {@link stampTermsConsent} for the path guard.
         * An OAuth callback must carry the sign-up page's consent and win the
         * invite code, or no row is written ({@link beforeOAuthUserCreate},
         * HON-1157).
         */
        before: async (user, ctx) => {
          if (ctx?.path === OAUTH_CALLBACK_PATH) {
            const consent = await beforeOAuthUserCreate(user, await getOAuthState())
            return { data: { ...user, ...consent } }
          }
          const consent = stampTermsConsent(ctx?.path)
          if (!consent) return
          return { data: { ...user, ...consent } }
        },
      },
      update: {
        /** A confirmed email change clears the reminder confirmation and tells the old address (HON-1137). */
        after: (user, ctx) => afterAccountEmailChange(user, ctx),
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
   * `usedById` link once the new user row exists and deletes the user's
   * waitlist request (see {@link afterEmailSignUp}). Google sign-up runs the
   * same gate in two halves: validate on `/sign-in/social`
   * ({@link beforeSocialSignIn}), claim on the callback, before the insert
   * ({@link beforeOAuthUserCreate}). All delegate to `src/lib/signup-codes.ts` so
   * the validation/claim logic stays unit-testable in isolation. See HON-488.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/update-user') {
        assertValidAccountNameUpdate(ctx.body)
        return
      }
      if (ctx.path === '/sign-in/social') {
        await beforeSocialSignIn(ctx.body)
        return
      }
      if (ctx.path !== '/sign-up/email') return
      // Terms consent first: rejecting here means the invite code below is
      // never claimed, so a consent failure can't burn a code (HON-457).
      assertTermsAccepted(ctx.body)
      await timeSignupStep('invite-code', () => validateAndClaimInviteCode(ctx.body))
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/oauth2/consent') {
        await captureMcpClientConnected({
          body: ctx.body,
          userId: ctx.context.session?.user.id,
          returned: ctx.context.returned,
        })
        return
      }
      if (ctx.path === OAUTH_CALLBACK_PATH) {
        await afterOAuthCallback(await getOAuthState(), ctx.context.newSession?.user?.id)
        return
      }
      if (ctx.path !== '/sign-up/email') return
      await afterEmailSignUp(ctx.body, ctx.context.newSession?.user?.id)
    }),
  },

  /**
   * OAuth 2.1 authorization server for MCP clients such as Claude's custom
   * connectors (HON-1150). The endpoints live under `/api/auth/oauth2/*`; the
   * discovery documents are served at the origin root by
   * `src/app/.well-known/*`. See docs/SECURITY.md → OAuth for MCP clients.
   */
  plugins: [
    // Signs the access tokens and serves `/api/auth/jwks`. The issuer is the
    // bare origin, so discovery sits at the root (see `getMcpIssuer`). The
    // session JWT header is off: nothing here reads it, and it would sign a
    // token on every `/get-session`.
    jwt({
      jwt: { issuer: getMcpIssuer(getServerBaseURL()) },
      disableSettingJwtHeader: true,
    }),
    // `mcp()` is the OAuth provider. Do not also register `oauthProvider()`.
    mcp({
      loginPage: '/sign-in',
      consentPage: '/consent',
      resource: getMcpResource(getServerBaseURL()),
      scopes: [...MCP_SCOPES],
      // The plugin seeds this resource row at init. Left to itself it writes
      // `allowedScopes: null`, which Prisma rejects for a `String[]` column,
      // and init failure fails every auth request. Listing the scopes (the
      // same set, so nothing narrows) gives the seed a value.
      resources: [
        {
          identifier: getMcpResource(getServerBaseURL()),
          name: 'Wobblepot MCP',
          allowedScopes: [...MCP_SCOPES],
        },
      ],
      // The default, `insertOnly`, never updates an existing row, so a scope
      // added to `MCP_SCOPES` would be cut from every token by the stale
      // `allowedScopes` (HON-1154). Nothing edits the row by hand, so this
      // config is its source of truth.
      resourceSeedMode: 'merge',
      // Open dynamic client registration (RFC 7591). Claude's connector
      // registers itself this way; `mcp()` enables no registration by default.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    // Client ID Metadata Documents, the registration MCP 2026-07-28 prefers.
    // The Node transport resolves the host once, accepts only public
    // addresses and follows no redirects, so a client_id URL cannot reach
    // internal hosts.
    cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
  ],
})

/**
 * Infer the session type from Better Auth
 */
export type Session = typeof auth.$Infer.Session
