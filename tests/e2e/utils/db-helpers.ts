/**
 * Seed/cleanup helpers for E2E tests that need DB state Playwright can't
 * create through the UI (e.g. an invite code for the HON-488 sign-up gate).
 *
 * The test-only `/api/__test__/signup-codes` endpoint is gated on
 * `RATE_LIMIT_BYPASS_ACTIVE` and returns 404 outside ci/test/dev — see the
 * route for details. We talk to it over HTTP rather than importing the
 * generated Prisma client directly: that client is bundled for Next.js and
 * does not import cleanly in Playwright's plain-Node runtime.
 */

const baseURL = (): string => process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export async function seedInviteCode(): Promise<string> {
  const res = await fetch(`${baseURL()}/api/__test__/signup-codes`, { method: 'POST' })
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
  await fetch(`${baseURL()}/api/__test__/signup-codes?code=${encodeURIComponent(code)}`, {
    method: 'DELETE',
  })
}
