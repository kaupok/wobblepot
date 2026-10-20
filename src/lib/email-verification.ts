/**
 * Shared values for account email verification (HON-1155).
 *
 * Client-safe: `SignUpForm` and `VerifyEmailNotice` import this, as do
 * `src/lib/auth.ts` and the E2E support route, so it holds no server imports.
 */

/**
 * Where Better Auth's `/api/auth/verify-email` redirects after the link is
 * opened. On a failure it appends `&error=<CODE>` to this URL.
 */
export const EMAIL_VERIFICATION_CALLBACK_URL = '/account?verified=1'

/** 24 hours. The email copy names this number. */
export const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60 * 24

/** What the Profile tab shows after the verification link redirected there. */
export type VerificationLanding = 'verified' | 'expired' | 'invalid'

/**
 * Reads the params Better Auth's verify-email redirect leaves on `/account`.
 *
 * `error` wins over `verified`, because a failure is `?verified=1&error=…`.
 * Better Auth 1.7.7 sends the code in upper case (`TOKEN_EXPIRED`,
 * `INVALID_TOKEN`, `USER_NOT_FOUND`); the match ignores case. Every error
 * other than an expired token reads as an invalid link.
 */
export function parseVerificationLanding(params: {
  verified?: string | string[]
  error?: string | string[]
}): VerificationLanding | null {
  const error = first(params.error)
  if (error) {
    return error.toUpperCase() === 'TOKEN_EXPIRED' ? 'expired' : 'invalid'
  }
  return first(params.verified) === '1' ? 'verified' : null
}

/**
 * The query that carries a landing to another page, in the same params
 * `parseVerificationLanding` reads. `/account` sends a user without a
 * household to `/onboarding`, and that redirect must keep the result: a new
 * user often opens the mail during onboarding. Rebuilt from the parsed value,
 * so no raw request input is forwarded.
 */
export function verificationLandingSearch(landing: VerificationLanding): string {
  switch (landing) {
    case 'verified':
      return '?verified=1'
    case 'expired':
      return '?verified=1&error=TOKEN_EXPIRED'
    case 'invalid':
      return '?verified=1&error=INVALID_TOKEN'
  }
}

/**
 * Where Better Auth's `/api/auth/verify-email` redirects after the link to a
 * new address is opened (HON-1137). On a failure it appends `&error=<CODE>`.
 */
export const CHANGE_EMAIL_CALLBACK_URL = '/account?emailChanged=1'

/** The `requestType` Better Auth 1.7.7 puts in the token sent to the new address. */
export const CHANGE_EMAIL_REQUEST_TYPE = 'change-email-verification'

/** What the Profile tab shows after the email-change link redirected there. */
export type ChangeEmailLanding = 'changed' | 'expired' | 'invalid'

/**
 * Reads the params the email-change link leaves on `/account`, the way
 * {@link parseVerificationLanding} reads the verification ones.
 *
 * Only `emailChanged=1` claims the `error` param, so a verification failure
 * still reads as one. A used link fails with `USER_NOT_FOUND`, because no user
 * has the token's old address any more, so every code except `INVALID_TOKEN`
 * reads as expired: the copy says "expired or already used".
 */
export function parseChangeEmailLanding(params: {
  emailChanged?: string | string[]
  error?: string | string[]
}): ChangeEmailLanding | null {
  if (first(params.emailChanged) !== '1') return null
  const error = first(params.error)
  if (!error) return 'changed'
  return error.toUpperCase() === 'INVALID_TOKEN' ? 'invalid' : 'expired'
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
