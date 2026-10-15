/**
 * Shared values for the sign-in methods on My account → Profile (HON-1158).
 *
 * Client-safe: `SignInMethods` imports this, as does the page and
 * `getSignInAccounts` in `src/lib/session.ts`, so it holds no server imports.
 */
import { getGoogleLinkErrorKey, type AuthErrorKey } from '@/lib/auth-errors'

/** Better Auth's `providerId` for an email and password account. */
export const CREDENTIAL_PROVIDER_ID = 'credential'

export const GOOGLE_PROVIDER_ID = 'google'

/**
 * Where Better Auth's OAuth callback redirects after Connect. On a failure it
 * appends `&error=<code>` to the same URL (`errorCallbackURL`).
 */
export const GOOGLE_LINK_CALLBACK_URL = '/account?linked=google'

export const SIGN_IN_ACCOUNTS_QUERY_KEY = ['auth', 'accounts'] as const

/**
 * One row of Better Auth's `/list-accounts`, narrowed to what the page uses.
 * `id` is the account row, which `/unlink-account` takes as `accountId`.
 */
export interface SignInAccount {
  id: string
  providerId: string
}

export function toSignInAccounts(
  accounts: ReadonlyArray<{ id: string; providerId: string }>,
): SignInAccount[] {
  return accounts.map(({ id, providerId }) => ({ id, providerId }))
}

export function hasPasswordAccount(accounts: ReadonlyArray<SignInAccount>): boolean {
  return accounts.some((account) => account.providerId === CREDENTIAL_PROVIDER_ID)
}

export function findGoogleAccount(accounts: ReadonlyArray<SignInAccount>): SignInAccount | null {
  return accounts.find((account) => account.providerId === GOOGLE_PROVIDER_ID) ?? null
}

/** What the Google link callback left on `/account`. */
export type GoogleLinkLanding = { kind: 'linked' } | { kind: 'failed'; errorKey: AuthErrorKey }

/**
 * Reads `GOOGLE_LINK_CALLBACK_URL`'s params: `?linked=google`, plus `error`
 * on a failure. Without `linked=google` it returns `null`, so a bare `error`
 * stays the verification link's (`parseVerificationLanding`).
 */
export function parseGoogleLinkLanding(params: {
  linked?: string | string[]
  error?: string | string[]
}): GoogleLinkLanding | null {
  if (first(params.linked) !== GOOGLE_PROVIDER_ID) return null
  const error = first(params.error)
  return error ? { kind: 'failed', errorKey: getGoogleLinkErrorKey(error) } : { kind: 'linked' }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
