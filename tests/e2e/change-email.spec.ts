// ROUTES: /account, /sign-in, /api/auth/change-email, /api/auth/verify-email · COMPONENTS: AccountProfilePage, ChangeEmailForm, SignInForm
import { test, expect } from '@playwright/test'
import { generateUniqueEmail, signIn, signOut, signUpWithHousehold } from './utils/test-helpers'
import { fetchChangeEmailPath, fetchUserState, expectUserExists } from './utils/e2e-support'

/**
 * Account email change (HON-1137).
 *
 * NOT `@smoke`: it signs up throwaway accounts, and the change link comes
 * from `/api/e2e-support`, which 404s on preview and staging. Tier 1 CI sends
 * no mail, so the spec submits the real form, then the back-channel mints the
 * same link the mail to the new address carries, and the spec opens Better
 * Auth's real `/api/auth/verify-email`.
 */

const SUBMIT = { name: 'Change email' }

test.describe('Email change', () => {
  test.setTimeout(90_000)

  test('change the email, open the link, sign in with the new address', async ({ page }) => {
    const { email, password } = await signUpWithHousehold(page)
    const newEmail = generateUniqueEmail()

    await page.goto('/account')
    const field = page.getByLabel('Email', { exact: true })
    await expect(field).toHaveValue(email)
    await field.fill(newEmail)
    await page.getByRole('button', SUBMIT).click()

    await expect(
      page.getByText(`Check ${newEmail} for a link. Your email changes when you open it.`),
    ).toBeVisible()
    // Nothing changes before the link is opened.
    await expect(field).toHaveValue(email)
    expectUserExists(await fetchUserState(email), email)
    expect(await fetchUserState(newEmail)).toEqual({ exists: false })

    await page.goto(await fetchChangeEmailPath(email, newEmail))

    await expect(page.getByText(`Your email address is now ${newEmail}.`)).toBeVisible()
    // The session shows the new address without a new sign-in.
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(newEmail)
    await expect(page).toHaveURL('/account')
    expect(expectUserExists(await fetchUserState(newEmail), newEmail).emailVerified).toBe(true)
    expect(await fetchUserState(email)).toEqual({ exists: false })

    await signOut(page)
    await signIn(page, newEmail, password)
    await page.goto('/account')
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(newEmail)
  })

  test('an expired link lands on the Profile tab with the expired copy', async ({ page }) => {
    const { email } = await signUpWithHousehold(page)
    const newEmail = generateUniqueEmail()

    await page.goto(await fetchChangeEmailPath(email, newEmail, { expired: true }))

    await expect(page).toHaveURL('/account')
    await expect(
      page.getByText(
        'This link has expired or was already used. Enter the new address again to get a new link.',
      ),
    ).toBeVisible()
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email)
    expectUserExists(await fetchUserState(email), email)
  })
})
