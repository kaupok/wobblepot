/**
 * Seed/cleanup helpers for E2E tests that need DB state Playwright can't
 * create through the UI (e.g. an invite code for the HON-488 sign-up gate).
 *
 * The test-only `/api/e2e-seed` endpoint is gated on
 * `RATE_LIMIT_BYPASS_ACTIVE` and returns 404 outside ci/test/dev — see the
 * route for details. We talk to it over HTTP rather than importing the
 * generated Prisma client directly: that client is bundled for Next.js and
 * does not import cleanly in Playwright's plain-Node runtime.
 */

/**
 * Base URL for direct (non-`page`) HTTP — invite seeding, consent cookies.
 *
 * Resolution order:
 * 1. `PLAYWRIGHT_BASE_URL` — remote tiers (preview/staging smoke).
 * 2. `E2E_LOCAL_PORT` — the isolated local runner (`pnpm test:e2e:local`)
 *    serves on a dedicated port (3100), not 3000. Without this, raw `fetch`
 *    here would hit :3000 (nothing listening) while `page.*` correctly uses
 *    Playwright's :3100 baseURL — the two must agree.
 * 3. `http://localhost:3000` — the default local dev server.
 *
 * Mirrors the `localBaseURL` logic in `playwright.config.ts`.
 */
export const e2eBaseURL = (): string =>
  process.env.PLAYWRIGHT_BASE_URL ??
  (process.env.E2E_LOCAL_PORT
    ? `http://localhost:${process.env.E2E_LOCAL_PORT}`
    : 'http://localhost:3000')

export async function seedInviteCode(): Promise<string> {
  const res = await fetch(`${e2eBaseURL()}/api/e2e-seed`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `[e2e/db-helpers] failed to seed invite code (status ${res.status}): ${body || '<empty>'}. ` +
        `Confirm E2E_DISABLE_RATE_LIMIT=1 and NEXT_PUBLIC_APP_ENV is one of ci/test/dev on the server.`,
    )
  }
  const json = (await res.json()) as { code: string }
  return json.code
}

export async function deleteInviteCode(code: string): Promise<void> {
  await fetch(`${e2eBaseURL()}/api/e2e-seed?code=${encodeURIComponent(code)}`, {
    method: 'DELETE',
  })
}
