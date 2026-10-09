// ROUTES: /sign-up, /onboarding, /profile, /sign-in, / · COMPONENTS: ProfilePage, ProfileNameForm, ChangePasswordForm, SignInForm, Header (User menu)
import { test, expect, type Page } from '@playwright/test'
import {
  grantEssentialCookieConsent,
  signIn,
  signOut,
  signUpWithHousehold,
} from './utils/test-helpers'

/**
 * Account name and password changes on `/profile` (HON-1129).
 *
 * NOT `@smoke`: it signs up a throwaway account through `/api/e2e-seed`, which
 * 404s on preview and staging, and it changes that account's password.
 */

async function submitSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.locator('input#email').fill(email)
  await page.locator('input#password').fill(password)
  await page.locator('form button[type="submit"]').click()
}

test.describe('Profile', () => {
  test.setTimeout(90_000)

  test('saves a new account name', async ({ page }) => {
    await signUpWithHousehold(page)

    await page.goto('/profile')
    const nameField = page.getByLabel('Name', { exact: true })
    await expect(nameField).toHaveValue('Test User')

    await nameField.fill('Renamed User')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Name saved')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Renamed User')
  })

  test('changes the password, signs out other sessions, and the new password signs in', async ({
    page,
    browser,
  }) => {
    const { email, password: oldPassword } = await signUpWithHousehold(page)
    const newPassword = `changed-${Date.now()}-pw`

    // A second browser session for the same user, signed in before the change.
    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await grantEssentialCookieConsent(otherPage)
    await signIn(otherPage, email, oldPassword)
    await otherPage.goto('/profile')
    await expect(otherPage).toHaveURL('/profile')

    await page.goto('/profile')
    await page.getByLabel('Current password').fill(oldPassword)
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm new password').fill(newPassword)
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect(page.getByText('Password changed. Other devices are signed out.')).toBeVisible()
    await expect(page.getByLabel('Current password')).toHaveValue('')

    // This session stays signed in.
    await page.reload()
    await expect(page).toHaveURL('/profile')
    await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()

    // The other session is signed out.
    await otherPage.goto('/profile')
    await expect(otherPage).toHaveURL(/\/sign-in/)
    await otherContext.close()

    await signOut(page)

    // The old password no longer signs in.
    await submitSignIn(page, email, oldPassword)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in/)

    // The new one does.
    await signIn(page, email, newPassword)
    await page.goto('/profile')
    await expect(page).toHaveURL('/profile')
  })

  test('a wrong current password shows translated copy and returns focus to the button', async ({
    page,
  }) => {
    await signUpWithHousehold(page)

    await page.goto('/profile')
    await page.getByLabel('Current password').fill('not-the-password-1234')
    await page.getByLabel('New password', { exact: true }).fill('another-new-password-99')
    await page.getByLabel('Confirm new password').fill('another-new-password-99')
    const submit = page.getByRole('button', { name: 'Change password' })
    await submit.click()

    await expect(
      page.getByText('The password you entered is incorrect. Please try again.'),
    ).toBeVisible()
    await expect(submit).toBeFocused()
  })
})
