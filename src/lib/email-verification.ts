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
export const EMAIL_VERIFICATION_CALLBACK_URL = '/profile?verified=1'

/** 24 hours. The email copy names this number. */
export const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60 * 24

/** What the profile shows after the verification link redirected there. */
export type VerificationLanding = 'verified' | 'expired' | 'invalid'

/**
 * Reads the params Better Auth's verify-email redirect leaves on `/profile`.
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

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
