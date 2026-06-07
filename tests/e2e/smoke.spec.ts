// ROUTES: /, /sign-in, /profile · COMPONENTS: Header, Home (landing hero), SignInForm, ProfilePage
import { test, expect } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'

/**
 * Staging-runnable smoke specs (HON-560). Everything in this file carries
 * `@smoke` and follows pattern (b) from tests/e2e/README.md: immutable
 * seeded fixtures (`SMOKE_TEST_EMAIL` / `SMOKE_TEST_PASSWORD`), read-only
 * assertions, and NO `/api/e2e-seed` usage — staging 404s that route by
 * design. `scripts/check-smoke-specs.sh` fails CI if a `@smoke` spec file
 * reaches for the seed-dependent sign-up helpers.
 */

test.describe('Smoke', { tag: '@smoke' }, () => {
  test('home renders with heading', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Meal planning for busy families' }),
    ).toBeVisible()
    await expect(page.getByRole('banner').getByRole('heading', { name: 'Wobblepot' })).toBeVisible()
  })

  test('seeded smoke user signs in and views profile', async ({ page }) => {
    const email = process.env.SMOKE_TEST_EMAIL
    const password = process.env.SMOKE_TEST_PASSWORD

    // Local runs without the fixture env are fine to skip. Remote tiers
    // (PLAYWRIGHT_BASE_URL set — preview/staging smoke) must fail loudly
    // instead: a missing secret would otherwise turn the production-
    // promotion gate into a silently-green no-op.
    if (!process.env.PLAYWRIGHT_BASE_URL) {
      test.skip(!email || !password, 'SMOKE_TEST_EMAIL / SMOKE_TEST_PASSWORD not set')
    }
    expect(email, 'SMOKE_TEST_EMAIL must be set for remote smoke runs').toBeTruthy()
    expect(password, 'SMOKE_TEST_PASSWORD must be set for remote smoke runs').toBeTruthy()

    // Pre-grant cookie consent so the bottom-fixed CookieBanner never
    // intercepts clicks — same rationale as signUp() in test-helpers.
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])

    await signIn(page, email!, password!)

    // Read-only assertions: the seeded fixture (user + "Smoke Test
    // Household" — see prisma/seed.ts seedTestUsers) renders its profile.
    // Without the household, /profile would redirect to /onboarding.
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.getByText(email!)).toBeVisible()
  })
})
