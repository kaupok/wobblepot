/**
 * Typed client for the test-only back-channel at `/api/e2e-support` (HON-479).
 *
 * The route is gated on `RATE_LIMIT_BYPASS_ACTIVE` and 404s on preview,
 * staging and production by design — same posture as `/api/e2e-seed`. Callers
 * must therefore treat "unavailable" as an expected outcome, not an error:
 * `fetchResetToken` returns `null` and the `@smoke` forgot-password spec falls
 * back to the mail provider (or skips). The account-deletion spec is CI-only,
 * so it uses the asserting variants that throw on a miss.
 *
 * Talks HTTP rather than importing Prisma for the reason spelled out in
 * `db-helpers.ts`: the generated client doesn't load in Playwright's Node.
 */
import { e2eBaseURL } from './db-helpers'

export interface ResetTokenPayload {
  token: string
  /** Better Auth's own callback path — hitting it redirects to /reset-password?token=… */
  resetPath: string
  expiresAt: string
}

// Discriminated on `exists`: the route answers a bare `{ exists: false }` for
// a purged row (user-state and household-state alike), so the count fields are
// only real on the `exists: true` arm. Keeping them required on both arms let
// specs read fields that were never in the response.
export type UserState =
  | { exists: false }
  | {
      exists: true
      deletedAt: string | null
      purgeScheduledFor: string | null
      householdIds: string[]
      sessions: number
      memberships: number
      households: number
      pantryItems: number
      mealPlans: number
    }

export type HouseholdState =
  | { exists: false }
  | {
      exists: true
      members: number
      pantryItems: number
      mealPlans: number
    }

/**
 * Narrows a `UserState` to its existing variant, failing loudly when the row
 * is gone — the type-safe way to reach the count fields.
 */
export function expectUserExists(
  state: UserState,
  label: string,
): Extract<UserState, { exists: true }> {
  if (!state.exists) {
    throw new Error(`[e2e/e2e-support] expected ${label} to exist, but the user row is gone`)
  }
  return state
}

function supportURL(action: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ action, ...params })
  return `${e2eBaseURL()}/api/e2e-support?${query.toString()}`
}

/**
 * Newest pending reset token for `email`, or `null` when the back-channel is
 * unavailable (404 — a shared tier) or no reset has been requested.
 */
export async function fetchResetToken(email: string): Promise<ResetTokenPayload | null> {
  const res = await fetch(supportURL('reset-token', { email }))
  if (!res.ok) {
    return null
  }
  return (await res.json()) as ResetTokenPayload
}

async function fetchOrThrow<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `[e2e/e2e-support] ${label} failed (status ${res.status}): ${body || '<empty>'}. ` +
        `Confirm E2E_DISABLE_RATE_LIMIT=1 and NEXT_PUBLIC_APP_ENV is one of ci/test/dev.`,
    )
  }
  return (await res.json()) as T
}

export async function fetchUserState(email: string): Promise<UserState> {
  return fetchOrThrow<UserState>(supportURL('user-state', { email }), 'user-state')
}

/**
 * Household-scoped counts, readable after the owner's row is gone — which is
 * exactly when the purge assertions need them.
 */
export async function fetchHouseholdState(householdId: string): Promise<HouseholdState> {
  return fetchOrThrow<HouseholdState>(
    supportURL('household-state', { householdId }),
    'household-state',
  )
}

/**
 * Back-dates `purgeScheduledFor` so the next purge-cron run treats the 30-day
 * grace window as elapsed. Only affects accounts that already have `deletedAt`
 * set, so it can't schedule a live account for deletion.
 */
export async function expirePurgeWindow(email: string): Promise<void> {
  const res = await fetch(supportURL('expire-purge', { email }), { method: 'POST' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `[e2e/e2e-support] expire-purge failed (status ${res.status}): ${body || '<empty>'}`,
    )
  }
}

/**
 * Invokes the real purge cron with the real bearer secret — no test-only
 * branch in the production route. Returns how many accounts it hard-deleted.
 */
export async function runPurgeCron(): Promise<{ purged: number; scanned: number }> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    throw new Error(
      '[e2e/e2e-support] CRON_SECRET is not set. The account-deletion spec calls ' +
        '/api/cron/purge-deleted-users with it; see .github/workflows/ci.yml and scripts/e2e-local.sh.',
    )
  }

  const res = await fetch(`${e2eBaseURL()}/api/cron/purge-deleted-users`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[e2e/e2e-support] purge cron failed (status ${res.status}): ${body}`)
  }
  return (await res.json()) as { purged: number; scanned: number }
}
