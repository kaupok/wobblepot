// ROUTES: /sign-up, /onboarding, /profile, /sign-in, /api/auth/verify-email · COMPONENTS: SignUpForm, ProfilePage, OnboardingPage, VerifyEmailNotice, SignInForm
import { test, expect } from '@playwright/test'
import { grantEssentialCookieConsent, signUp, signUpWithHousehold } from './utils/test-helpers'
import { fetchUserState, fetchVerifyEmailPath, expectUserExists } from './utils/e2e-support'

/**
 * Account email verification (HON-1155).
 *
 * NOT `@smoke`: it signs up throwaway accounts, and the verification link
 * comes from `/api/e2e-support`, which 404s on preview and staging. Tier 1 CI
 * sends no mail, so the back-channel mints the same link the sign-up mail
 * carries, and the spec opens Better Auth's real `/api/auth/verify-email`.
 */

const NOT_VERIFIED =
  'Your email address is not verified yet. Open the link in the email we sent you.'
const VERIFIED = 'Your email address is verified.'
const RESEND = { name: 'Send the link again' }

test.describe('Email verification', () => {
  test.setTimeout(90_000)

  test('sign up, open the link, see the verified state', async ({ page }) => {
    const { email } = await signUpWithHousehold(page)

    // Soft verification: the new account is signed in before the click.
    await page.goto('/profile')
    await expect(page.getByText(NOT_VERIFIED)).toBeVisible()
    await expect(page.getByRole('button', RESEND)).toBeVisible()

    await page.goto(await fetchVerifyEmailPath(email))

    await expect(page.getByText(VERIFIED)).toBeVisible()
    await expect(page.getByText(NOT_VERIFIED)).toBeHidden()
    await expect(page.getByRole('button', RESEND)).toBeHidden()
    // The notice clears the redirect params, so a reload does not repeat it.
    await expect(page).toHaveURL('/profile')
    expect(expectUserExists(await fetchUserState(email), email).emailVerified).toBe(true)

    await page.reload()
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
    await expect(page.getByText(VERIFIED)).toBeHidden()
    await expect(page.getByText(NOT_VERIFIED)).toBeHidden()
  })

  test('a broken link lands on the profile with Resend', async ({ page }) => {
    const { email } = await signUpWithHousehold(page)

    await page.goto(
      `/api/auth/verify-email?token=not-a-token&callbackURL=${encodeURIComponent('/profile?verified=1')}`,
    )

    await expect(page).toHaveURL('/profile')
    await expect(
      page.getByText('This verification link does not work. Send a new one.'),
    ).toBeVisible()
    await expect(page.getByRole('button', RESEND)).toBeVisible()
    expect(expectUserExists(await fetchUserState(email), email).emailVerified).toBe(false)
  })

  test('an expired link lands on the profile with the expired copy and Resend', async ({
    page,
  }) => {
    const { email } = await signUpWithHousehold(page)

    // A real token past its expiry, so Better Auth emits its own TOKEN_EXPIRED.
    await page.goto(await fetchVerifyEmailPath(email, { expired: true }))

    await expect(page).toHaveURL('/profile')
    await expect(
      page.getByText('This verification link has expired. Send a new one.'),
    ).toBeVisible()
    await expect(page.getByRole('button', RESEND)).toBeVisible()
    expect(expectUserExists(await fetchUserState(email), email).emailVerified).toBe(false)
  })

  // A new user often opens the mail before onboarding is done. `/profile`
  // sends a user without a household to `/onboarding`, with the result.
  test('a link opened during onboarding shows its result there', async ({ page }) => {
    const { email } = await signUp(page)

    await page.goto(
      `/api/auth/verify-email?token=not-a-token&callbackURL=${encodeURIComponent('/profile?verified=1')}`,
    )
    await expect(page).toHaveURL('/onboarding')
    await expect(
      page.getByText('This verification link does not work. Send a new one.'),
    ).toBeVisible()
    await expect(page.getByRole('button', RESEND)).toBeVisible()

    await page.goto(await fetchVerifyEmailPath(email))

    await expect(page.getByText(VERIFIED)).toBeVisible()
    await expect(page).toHaveURL('/onboarding')
    expect(expectUserExists(await fetchUserState(email), email).emailVerified).toBe(true)
  })

  test('a link opened while signed out verifies, then signs in to the profile', async ({
    page,
    browser,
  }) => {
    const { email, password } = await signUpWithHousehold(page)
    const verifyPath = await fetchVerifyEmailPath(email)

    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await grantEssentialCookieConsent(otherPage)

    // The endpoint sets the flag, then `/profile` sends the anonymous visitor
    // through sign-in with the params kept in `returnUrl`.
    await otherPage.goto(verifyPath)
    await expect(otherPage).toHaveURL(/\/sign-in\?returnUrl=/)
    expect(expectUserExists(await fetchUserState(email), email).emailVerified).toBe(true)

    await otherPage.locator('input#email').fill(email)
    await otherPage.locator('input#password').fill(password)
    await otherPage.locator('form button[type="submit"]').click()

    await expect(otherPage.getByText(VERIFIED)).toBeVisible()
    await expect(otherPage).toHaveURL('/profile')

    await otherContext.close()
  })
})
