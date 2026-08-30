import { test, expect } from '@playwright/test'

/**
 * Seeded-fixture credentials for `@smoke` specs (pattern (b), HON-560).
 *
 * The fixtures are planted by `prisma/seed.ts` → `seedTestUsers()` when
 * `SEED_TEST_USERS=1`; the contract is documented in `tests/e2e/README.md`.
 * When the credentials are missing the seed silently no-ops, so specs need a
 * consistent story about what that means:
 *
 * - **Local / tier 1** — skip. Not every contributor has the CI secrets in
 *   `.env`, and a hard failure there is noise, not signal.
 * - **Remote tiers** (`PLAYWRIGHT_BASE_URL` set — preview-smoke,
 *   staging-smoke) — fail loudly. A missing secret must never turn the
 *   production-promotion gate into a silent green.
 *
 * This mirrors the inline logic in `tests/e2e/smoke.spec.ts`, extracted so the
 * HON-479 specs can't drift from it.
 */
export interface FixtureCredentials {
  email: string
  password: string
}

function readFixture(emailVar: string, passwordVar: string, reason: string): FixtureCredentials {
  const email = process.env[emailVar]
  const password = process.env[passwordVar]

  if (!process.env.PLAYWRIGHT_BASE_URL) {
    test.skip(!email || !password, `${emailVar} / ${passwordVar} not set — ${reason}`)
  }
  expect(email, `${emailVar} must be set for remote smoke runs`).toBeTruthy()
  expect(password, `${passwordVar} must be set for remote smoke runs`).toBeTruthy()

  return { email: email!, password: password! }
}

/** Stable read-mostly account that owns "Smoke Test Household" and its meal plan. */
export function smokeFixture(): FixtureCredentials {
  return readFixture('SMOKE_TEST_EMAIL', 'SMOKE_TEST_PASSWORD', 'seeded smoke fixture missing')
}

/** Dedicated account whose password the reset flow is free to churn. */
export function forgotPasswordFixture(): FixtureCredentials {
  return readFixture(
    'FORGOT_PASSWORD_TEST_EMAIL',
    'FORGOT_PASSWORD_TEST_PASSWORD',
    'seeded forgot-password fixture missing',
  )
}

/**
 * Password that satisfies both gates a new password has to clear: Better
 * Auth's 12-character minimum and the HIBP breached-password check in
 * `hashPasswordWithBreachCheck` (HON-464). Randomised per call so a run never
 * reuses a value that a previous run may have leaked into an artifact.
 */
export function generateStrongPassword(): string {
  const random = Math.random().toString(36).slice(2, 12)
  return `Wp-e2e-${random}-${Date.now().toString(36)}`
}
