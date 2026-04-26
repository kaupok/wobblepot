import { expect, type Page } from '@playwright/test'
import { seedInviteCode } from './db-helpers'

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
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([
    {
      name: 'consent-v1',
      value: 'essential',
      url: baseURL,
      sameSite: 'Lax',
    },
  ])

  await page.goto('/sign-up')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)

  // Invite-code gate (HON-488). The form only renders the field when the
  // server-side flag is `true` — that is the default in CI (PostHog unset).
  // Default behaviour: seed a fresh code and use it. Pass `inviteCode: null`
  // to deliberately submit without one (e.g. negative-path tests).
  //
  // Use the `name="inviteCode"` attribute rather than `getByLabel('Invite
  // code')` so the helper still works against the Estonian sign-up surface
  // (where the label is "Kutsekood"). Locale-stable selectors are required
  // for any helper used by `@i18n platform smoke` tests.
  const inviteField = page.locator('input[name="inviteCode"]')
  let usedInviteCode: string | null = null
  if (await inviteField.count()) {
    if (options.inviteCode !== null) {
      const code = options.inviteCode ?? (await seedInviteCode())
      await inviteField.fill(code)
      usedInviteCode = code
    }
  }

  await page.getByRole('button', { name: 'Sign up' }).click()

  // Wait for navigation away from sign-up page
  await page.waitForURL((url) => !url.pathname.includes('/sign-up'))

  return { email, password, name, inviteCode: usedInviteCode }
}

/**
 * Creates a household during onboarding.
 * Onboarding is a 2-step flow: step 1 = household name, step 2 = members.
 */
export async function createHousehold(page: Page, householdName?: string): Promise<void> {
  await page.waitForURL('/onboarding')

  if (householdName) {
    await page.getByLabel('Household name').clear()
    await page.getByLabel('Household name').fill(householdName)
  }

  // Step 1 → 2: advance past the household-name step
  await page.getByRole('button', { name: 'Continue' }).click()

  // The form has a 100ms guard (`justTransitioned`) that ignores submissions
  // immediately after a step transition, to prevent Enter-key race conditions.
  // Wait for step 2 to render, then for the guard window to elapse, before
  // clicking the submit button — otherwise the click is silently swallowed.
  await expect(page.getByRole('heading', { name: 'Household members' })).toBeVisible()
  await page.waitForTimeout(150)

  // Step 2: submit with defaults (1 member)
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL('/')
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
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Wait for navigation away from sign-in page
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
}

/**
 * Signs out the current user via the header user-menu dropdown.
 * Desktop: opens the "User menu" button, clicks the "Sign out" menuitem.
 * Mobile: the mobile nav exposes a direct "Sign out" button inside the sheet.
 */
export async function signOut(page: Page): Promise<void> {
  const userMenuTrigger = page.getByRole('button', { name: 'User menu' })
  if (await userMenuTrigger.isVisible()) {
    await userMenuTrigger.click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
  } else {
    await page.getByRole('button', { name: 'Sign out' }).click()
  }
  await page.waitForURL('/')
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
