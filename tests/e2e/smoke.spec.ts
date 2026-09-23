// ROUTES: /, /sign-in, /profile · COMPONENTS: Header, Home (landing hero), SignInForm, ProfilePage, TimelineView, FillDaysAction
import { test, expect, type Page } from '@playwright/test'
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

/**
 * Sign the seeded smoke user in, or skip locally when the fixture env is
 * absent. Remote tiers (PLAYWRIGHT_BASE_URL set — preview/staging smoke) fail
 * loudly instead: a missing secret would otherwise turn the production-
 * promotion gate into a silently-green no-op.
 */
async function signInSmokeUser(page: Page): Promise<string> {
  const email = process.env.SMOKE_TEST_EMAIL
  const password = process.env.SMOKE_TEST_PASSWORD

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
  return email!
}

test.describe('Smoke', { tag: '@smoke' }, () => {
  test('home renders with heading', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Meal planning for busy families' }),
    ).toBeVisible()
    await expect(page.getByRole('banner').getByRole('heading', { name: 'Wobblepot' })).toBeVisible()
  })

  test('seeded smoke user signs in and views profile', async ({ page }) => {
    const email = await signInSmokeUser(page)

    // Read-only assertions: the seeded fixture (user + "Smoke Test
    // Household" — see prisma/seed.ts seedTestUsers) renders its profile.
    // Without the household, /profile would redirect to /onboarding.
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()
  })

  // HON-751 and HON-777 both shipped a Today page whose server and browser
  // rendered different text, so React threw error 418 and re-rendered the
  // whole tree on every load — invisible to every other assertion. The seeded
  // household (en) has an empty plan, so Today renders the timeline with its
  // fill bar (the HON-777 date range).
  test('Today hydrates without a mismatch', async ({ page }) => {
    await signInSmokeUser(page)

    const hydrationErrors: string[] = []
    const isHydrationError = (text: string) => /React error #418|hydrat/i.test(text)
    page.on('console', (message) => {
      if (message.type() === 'error' && isHydrationError(message.text())) {
        hydrationErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      if (isHydrationError(error.message)) hydrationErrors.push(error.message)
    })

    // A full document load, not the client-side redirect after sign-in, so
    // the server HTML is actually hydrated.
    await page.goto('/')
    const fillLabel = page.getByText(/^Fill /)
    await expect(fillLabel).toBeVisible()

    // Changing the day count re-renders the label, which only happens once
    // the page is interactive — so hydration has finished by the time it does.
    const before = await fillLabel.textContent()
    await page.getByRole('combobox', { name: 'Number of days to fill' }).click()
    await page.getByRole('option', { name: '3 days' }).click()
    await expect(fillLabel).not.toHaveText(before ?? '')

    expect(hydrationErrors).toEqual([])
  })
})
