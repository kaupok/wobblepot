// ROUTES: /, /sign-in, /profile · COMPONENTS: Header, Home (landing hero, phone closing call to action), LandingWeek, SignInForm, ProfilePage, TimelineView, FillDaysAction
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

/**
 * The app font reaches `body`. With the `next/font` variable classes on `body`
 * rather than `html`, Tailwind's `:root` font stack resolved to the system
 * fonts, so no page rendered in Geist and jsdom could not see it (HON-1045).
 * `Geist` alone, so `Geist Mono` or `Geist Fallback` first does not pass.
 */
async function expectBodyInGeist(page: Page) {
  const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  expect(fontFamily).toMatch(/^["']?Geist["']?(,|$)/)
}

test.describe('Smoke', { tag: '@smoke' }, () => {
  test('home renders with heading', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Dinner, decided. For the whole week.' }),
    ).toBeVisible()
    await expect(page.getByRole('banner').getByRole('link', { name: 'Wobblepot' })).toBeVisible()
    await expectBodyInGeist(page)
  })

  // Below `md` the scrolled header folds to an icon, so phones get the button
  // once more above the maker's line; from `md` the header keeps Sign up on
  // screen and the page has the hero's button only (HON-1060). jsdom applies no
  // media queries, so only a real browser can show the `md:hidden` switch.
  test('landing asks once more on phones only', async ({ page }) => {
    const cta = page.getByRole('main').getByRole('link', { name: "Plan this week's dinners" })
    const closingLine = page.getByText(
      'Two minutes at setup, then a week of dinners and one shopping list.',
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(cta).toHaveCount(2)
    // The week strip's `sr-only` "Cooked" text once widened the page (HON-1147).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(cta.last()).toBeVisible()
    await expect(closingLine).toBeVisible()

    // A role locator skips `display: none`, so the hidden closing button drops
    // out of the count rather than resolving as a hidden match.
    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(cta).toHaveCount(1)
    await expect(cta).toBeVisible()
    await expect(closingLine).toBeHidden()
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
    await expectBodyInGeist(page)
  })
})
