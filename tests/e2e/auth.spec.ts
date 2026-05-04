// ROUTES: /sign-up, /sign-in, /onboarding, /, /profile · COMPONENTS: SignUpForm (with HON-488 invite-code gate), SignInForm, CreateHouseholdForm, Header (User menu)
import { test, expect } from '@playwright/test'
import {
  generateUniqueEmail,
  signUp,
  signIn,
  signOut,
  createHousehold,
  TEST_PASSWORD,
  TEST_NAME,
} from './utils/test-helpers'

test.describe('Authentication flows', () => {
  test('sign up -> onboarding -> create household -> view home', async ({ page }) => {
    const email = generateUniqueEmail()
    const name = 'New User'

    // Sign up
    await signUp(page, { email, name })

    // Should redirect to onboarding (step 1 — household name)
    await expect(page).toHaveURL('/onboarding')
    await expect(page.getByRole('heading', { name: 'Create your household' })).toBeVisible()

    // Complete the 2-step onboarding flow (name → members → submit)
    const householdName = `${name}'s Household`
    await createHousehold(page, householdName)

    // Should redirect to home with the first-time setup card
    await expect(page).toHaveURL('/')
    await expect(page.getByText(`Welcome to Wobblepot, ${name}!`)).toBeVisible()
  })

  test('sign in -> view profile', { tag: '@smoke' }, async ({ page }) => {
    const email = generateUniqueEmail()
    const name = 'Existing User'

    // First sign up and complete onboarding
    await signUp(page, { email, name })
    await createHousehold(page)

    // Sign out to test sign in
    await signOut(page)
    await expect(page).toHaveURL('/')

    // Sign in
    await signIn(page, email)

    // Should redirect to Today dashboard (default returnUrl)
    await expect(page).toHaveURL('/')
  })

  test('sign out -> redirect to home with sign in link', async ({ page }) => {
    const email = generateUniqueEmail()

    // Sign up and complete onboarding
    await signUp(page, { email })
    await createHousehold(page)

    // Verify signed in state — the User menu trigger only renders when authed
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible()

    // Sign out
    await signOut(page)

    // Should be on home page with sign in option
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible()
  })

  test('invalid credentials show error message', async ({ page }) => {
    const email = generateUniqueEmail()

    // Create a real user first
    await signUp(page, { email })
    await createHousehold(page)
    await signOut(page)

    // Try wrong password - should show error
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('wrongpassword123')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Wait for error message (not the route announcer)
    // Better Auth returns generic "Invalid email or password" for security
    const wrongPwdAlert = page.locator('[role="alert"]').filter({ hasText: /incorrect|invalid/i })
    await expect(wrongPwdAlert).toBeVisible()

    // Try nonexistent email - should also show same generic error for security
    // (prevents email enumeration attacks)
    await page.getByLabel('Email').clear()
    await page.getByLabel('Email').fill('definitely-does-not-exist@example.com')
    await page.getByLabel('Password').clear()
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Same generic error message for nonexistent email (security best practice)
    const noUserAlert = page.locator('[role="alert"]').filter({ hasText: /incorrect|invalid/i })
    await expect(noUserAlert).toBeVisible()
  })

  test('password too short prevents form submission', async ({ page }) => {
    // Pre-grant consent so the bottom-fixed cookie banner doesn't overlap the
    // Sign up button. With the HON-488 invite-code field the form is taller
    // and the button now sits in the same vertical region as the banner;
    // without consent the click is intercepted and the test times out.
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: baseURL, sameSite: 'Lax' }])

    await page.goto('/sign-up')
    await page.getByLabel('Name').fill(TEST_NAME)
    await page.getByLabel('Email').fill(generateUniqueEmail())
    await page.getByLabel('Password').fill('short') // Only 5 chars; auth.ts sets minPasswordLength to 12

    await page.getByRole('button', { name: 'Sign up' }).click()

    // Should stay on sign-up page (HTML5 validation prevents submission)
    await expect(page).toHaveURL('/sign-up')
  })

  test('invite-only sign-up: missing code is rejected with a friendly error', async ({ page }) => {
    // The flag defaults to `true` in CI (PostHog unset → fail-open default),
    // so the form will render the invite-code field. Pass `inviteCode: null`
    // to deliberately submit without one and assert the rejection.
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: baseURL, sameSite: 'Lax' }])
    await page.goto('/sign-up')

    // The invite-code field MUST be visible — if not, this assertion fails
    // loud rather than the test silently passing on a server with the gate
    // turned off.
    await expect(page.getByLabel('Invite code')).toBeVisible()

    await page.getByLabel('Name').fill(TEST_NAME)
    await page.getByLabel('Email').fill(generateUniqueEmail())
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    // Intentionally do not fill the invite-code field, but bypass the
    // browser's `required` validator so the form actually submits — we want
    // to assert the server-side rejection, not the HTML5 layer.
    await page.getByLabel('Invite code').evaluate((el) => el.removeAttribute('required'))
    await page.getByRole('button', { name: 'Sign up' }).click()

    // Stay on /sign-up and surface the friendly invite-code error.
    await expect(page).toHaveURL('/sign-up')
    const inviteAlert = page.locator('[role="alert"]').filter({ hasText: /invite code/i })
    await expect(inviteAlert).toBeVisible()
  })

  test('returnUrl redirects to specified page after sign in', async ({ page }) => {
    const email = generateUniqueEmail()

    // Create user and complete onboarding
    await signUp(page, { email })
    await createHousehold(page)
    await signOut(page)

    // Sign in with returnUrl pointing to settings/invites
    await page.goto('/sign-in?returnUrl=/profile')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Wait for navigation away from sign-in page and then to settings/invites
    await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
    await expect(page).toHaveURL('/profile')
  })
})
