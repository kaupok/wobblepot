import { expect, type Page } from '@playwright/test'
import { seedInviteCode, e2eBaseURL } from './db-helpers'

/**
 * Default test password. Must meet Better Auth's `minPasswordLength` (12+
 * chars) and avoid HIBP breach matches — short / common passwords like
 * `testpass123` fail sign-up on both fronts.
 */
export const TEST_PASSWORD = 'honkadori-e2e-test-2026'

/**
 * Default test user name
 */
export const TEST_NAME = 'Test User'

/**
 * Generates a unique email address for test isolation
 * Format: test-{timestamp}-{random}@example.com
 */
export function generateUniqueEmail(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `test-${timestamp}-${random}@example.com`
}

/**
 * Signs up a new user via the UI.
 *
 * Auto-seeds an invite code via Prisma when the sign-up form has the field
 * (HON-488). The `invite_code_required` flag defaults to `true` whenever
 * PostHog is unconfigured (CI default), so existing tests need a code on
 * each sign-up; passing `inviteCode` explicitly skips the auto-seed.
 *
 * Waits for redirect away from sign-up page.
 */
export async function signUp(
  page: Page,
  options: {
    name?: string
    email?: string
    password?: string
    inviteCode?: string | null
  } = {},
): Promise<{ email: string; password: string; name: string; inviteCode: string | null }> {
  const email = options.email ?? generateUniqueEmail()
  const password = options.password ?? TEST_PASSWORD
  const name = options.name ?? TEST_NAME

  // Pre-grant cookie consent so the bottom-fixed CookieBanner never
  // renders and intercepts clicks on elements low on the page (e.g. the
  // profile page's Delete account button). Keeps the rest of each test
  // focused on its real assertion without a per-test "click Accept all"
  // dance. Uses `essential` which satisfies the banner without flipping
  // the analytics flag.
  const baseURL = e2eBaseURL()
  await page.context().addCookies([
    {
      name: 'consent-v1',
      value: 'essential',
      url: baseURL,
      sameSite: 'Lax',
    },
  ])

  await page.goto('/sign-up')
  // Locale-stable selectors: the sign-up form chrome is externalized (HON-508),
  // so label text varies by locale (e.g. "Name" vs "Nimi") for any helper used
  // by `@i18n platform smoke` tests. Use the input `id` (English-only,
  // identifier-not-copy) instead of `getByLabel`.
  await page.locator('input#name').fill(name)
  await page.locator('input#email').fill(email)
  await page.locator('input#password').fill(password)

  // Invite-code gate (HON-488). The form only renders the field when the
  // server-side flag is `true` — that is the default in CI (PostHog unset).
  // Default behaviour: seed a fresh code and use it. Pass `inviteCode: null`
  // to deliberately submit without one (e.g. negative-path tests).
  const inviteField = page.locator('input[name="inviteCode"]')
  let usedInviteCode: string | null = null
  if (await inviteField.count()) {
    if (options.inviteCode !== null) {
      const code = options.inviteCode ?? (await seedInviteCode())
      await inviteField.fill(code)
      usedInviteCode = code
    }
  }

  // Terms-consent checkbox (HON-457): required on every sign-up; submitting
  // unticked shows an error instead (HON-848). Locale-stable id selector — the
  // label copy is localized. Radix renders a button with role="checkbox", so
  // click, not check.
  await page.locator('#acceptTerms').click()

  // Submit button — use `type="submit"` rather than `name: 'Sign up'`, which
  // changes to "Loo konto" in Estonian.
  await page.locator('form button[type="submit"]').click()

  // Wait for navigation away from sign-up page
  await page.waitForURL((url) => !url.pathname.includes('/sign-up'))

  return { email, password, name, inviteCode: usedInviteCode }
}

/**
 * Creates a household during onboarding, and leaves before the first plan.
 * Onboarding is a 4-step flow: step 1 = welcome and household name, step 2 =
 * members, step 3 = allergens (the household is created on leaving it),
 * step 4 = the first plan. The helper ticks no allergen, stops at step 4 and
 * opens '/', where a household with no plan
 * gets the same choices (`FirstTimeSetup`), so no spec pays for a generation
 * it did not ask for.
 *
 * Locale-stable selectors: the onboarding form chrome is externalized
 * (HON-510), so label and button text vary by locale. The `@i18n platform
 * smoke` test runs this helper under an `et-EE` browser session — chrome
 * during onboarding renders in Estonian (no household exists yet, so the
 * resolver picks up Accept-Language). We use the input `id="name"` and
 * structural selectors (button type, `aria-pressed` on the allergen toggles)
 * instead of `getByRole('button', { name })` to stay locale-agnostic.
 */
export async function createHousehold(page: Page, householdName?: string): Promise<void> {
  await page.waitForURL('/onboarding')

  if (householdName) {
    await page.locator('input#name').clear()
    await page.locator('input#name').fill(householdName)
  }

  // Step 1 → 2: advance past the household-name step. Step 1 contains exactly
  // one button (Continue, `type="button"`); steps 2 and 3 have several
  // type-button buttons (Back, Add adult, Add child, the allergen toggles) plus
  // the submit button, so this selector is only unambiguous in step 1.
  await page.locator('form button[type="button"]').click()

  // The form has a 100ms guard (`justTransitioned`) that ignores submissions
  // immediately after a step transition, to prevent Enter-key race conditions.
  // Wait for the step's submit button to render, then for the guard window to
  // elapse, before clicking — otherwise the click is silently swallowed.
  const submit = page.locator('form button[type="submit"]')
  await expect(submit).toBeVisible()
  await page.waitForTimeout(150)

  // Step 2 → 3: Continue with defaults (the user alone). Step 2's Continue is
  // the form's submit button, and it does not create the household.
  await submit.click()

  // Step 3 is the only step with toggle buttons (the allergens).
  await expect(page.locator('form button[aria-pressed]').first()).toBeVisible()
  await page.waitForTimeout(150)

  // Step 3 → 4: submit with nothing ticked, which creates the household.
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/households') && r.request().method() === 'POST',
    ),
    submit.click(),
  ])
  expect(created.ok()).toBe(true)

  // Step 4 is the only step with radio groups (start day, number of days).
  await expect(page.getByRole('radiogroup').first()).toBeVisible()
  await page.goto('/')
}

/**
 * Signs in an existing user via the UI
 * Waits for redirect away from sign-in page
 */
export async function signIn(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<void> {
  await page.goto('/sign-in')
  // Locale-stable selectors — see signUp().
  await page.locator('input#email').fill(email)
  await page.locator('input#password').fill(password)
  await page.locator('form button[type="submit"]').click()

  // Wait for navigation away from sign-in page
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
}

/**
 * Signs out the current user via the header user menu. Both viewports open it
 * from the "User menu" person icon (HON-775): desktop shows a dropdown with a
 * "Sign out" menuitem, mobile a sheet (a dialog) with a "Sign out" button.
 */
export async function signOut(page: Page): Promise<void> {
  // Use English-text role queries — auth.spec.ts targets the English chrome
  // explicitly. If a future i18n smoke spec needs to sign out under a non-en
  // session, switch to locale-stable selectors (data-testid / nth-of-type)
  // for both the menu trigger and the menuitem here.
  const userMenuTrigger = page.getByRole('button', { name: 'User menu' })
  if (await userMenuTrigger.isVisible()) {
    // Open-and-click is retried as a unit: a page that autofocuses an input on
    // hydration steals focus from the just-opened Radix menu, which closes on
    // focus-outside and detaches the menuitem mid-click ("element was detached
    // from the DOM"). The forgot-password fixture user has no household by
    // design (prisma/seed.ts), so it signs out from the onboarding wizard,
    // whose "Household name" textbox autofocuses — that spec hit this on every
    // attempt in CI run 33729584094. Reopening on the next pass clears it.
    await expect(async () => {
      // A detached click can still have landed: sign-out then navigates and the
      // trigger never comes back, so an unbounded click here would block until
      // the 60s test timeout instead of reporting through toPass. Both clicks
      // are bounded, and an already-signed-out page ends the retry loop.
      if (await page.getByRole('link', { name: 'Sign in' }).isVisible()) return
      // Scoped to the dialog so a page's own "Sign out" button cannot match.
      const signOutItem = page
        .getByRole('menuitem', { name: 'Sign out' })
        .or(page.getByRole('dialog').getByRole('button', { name: 'Sign out' }))
      if (!(await signOutItem.isVisible())) {
        await userMenuTrigger.click({ timeout: 5_000 })
      }
      await signOutItem.click({ timeout: 5_000 })
    }).toPass({ timeout: 15_000 })
  } else {
    await page.getByRole('button', { name: 'Sign out' }).click()
  }
  await page.waitForURL('/')
  // `waitForURL('/')` resolves immediately when the page is ALREADY at '/'
  // (the usual case — tests sign out right after onboarding lands on '/'),
  // i.e. potentially before the sign-out POST has cleared the session
  // cookie. A follow-up `goto('/sign-in')` then races the cookie clear,
  // sees a live session, and bounces back to '/'. Wait for the signed-out
  // chrome (header "Sign in" link only renders after router.refresh() with
  // the session gone) before returning.
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
}

/**
 * Waits for a dialog to be visible and animation to complete
 * Radix dialogs transition to data-state="open" when fully visible
 */
export async function waitForDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('data-state', 'open')
}

/**
 * Complete sign up and onboarding flow
 * Returns the user credentials
 */
export async function signUpWithHousehold(
  page: Page,
  options: { name?: string; email?: string; householdName?: string } = {},
): Promise<{ email: string; password: string; name: string }> {
  const credentials = await signUp(page, options)
  await createHousehold(page, options.householdName)
  return credentials
}
