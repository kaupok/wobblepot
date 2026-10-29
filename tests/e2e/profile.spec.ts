// ROUTES: /sign-up, /onboarding, /account, /sign-in, / · COMPONENTS: AccountProfilePage, AccountTabs, RouteTabs, ProfileNameForm, SignInMethods, ChangePasswordForm, SignInForm, Header (User menu)
import { expect, type Page, test } from '@playwright/test'

import {
  grantEssentialCookieConsent,
  signIn,
  signOut,
  signUpWithHousehold,
} from './utils/test-helpers'

/**
 * Account name and password changes on My account → Profile, `/account` (HON-1129).
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

  // HON-1229: the account menu opens My account, and its four tabs are links
  // a keyboard reaches in order. The tab list is in the layout, which stays
  // mounted, so focus stays on the tab and does not fall to <body>.
  test('the account menu opens My account, and Tab and Enter move between its tabs', async ({
    page,
  }) => {
    await signUpWithHousehold(page)

    await page.goto('/')
    await page.getByRole('button', { name: 'User menu' }).click()
    // A dropdown from `md` up, a sheet on a phone.
    await page
      .getByRole('menuitem', { name: 'My account' })
      .or(page.getByRole('dialog').getByRole('link', { name: 'My account' }))
      .click()
    await expect(page).toHaveURL('/account')
    await expect(page.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible()

    const tabs = page.getByRole('navigation', { name: 'Account sections' })
    await expect(tabs.getByRole('link')).toHaveText([
      'Profile',
      'Reminders',
      'Connections',
      'Your data',
    ])
    const profileTab = tabs.getByRole('link', { name: 'Profile' })
    const connectionsTab = tabs.getByRole('link', { name: 'Connections' })
    await expect(profileTab).toHaveAttribute('aria-current', 'page')

    await profileTab.focus()
    await page.keyboard.press('Tab')
    await expect(tabs.getByRole('link', { name: 'Reminders' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(connectionsTab).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL('/account/connections')
    await expect(connectionsTab).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: 'Screens and scripts' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Change password' })).toHaveCount(0)
    await expect(connectionsTab).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(tabs.getByRole('link', { name: 'Your data' })).toBeFocused()
  })

  test('saves a new account name', async ({ page }) => {
    await signUpWithHousehold(page)

    await page.goto('/account')
    const nameField = page.getByLabel('Name', { exact: true })
    await expect(nameField).toHaveValue('Test User')

    await nameField.fill('Renamed User')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Name saved')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Renamed User')
  })

  // HON-1158: an email sign-up has a password, so it keeps the change form.
  // CI runs with Google off; the assertions hold either way.
  test('lists the password as a sign-in method and keeps the change form', async ({ page }) => {
    await signUpWithHousehold(page)

    await page.goto('/account')
    const methods = page.getByRole('region', { name: 'Sign-in methods' })
    await expect(methods.getByRole('listitem').first()).toHaveText(/Password\s*Set/)
    await expect(methods.getByRole('button', { name: 'Disconnect' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Set a password' })).toHaveCount(0)
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
    await otherPage.goto('/account')
    await expect(otherPage).toHaveURL('/account')

    await page.goto('/account')
    await page.getByLabel('Current password').fill(oldPassword)
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm new password').fill(newPassword)
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect(page.getByText('Password changed. Other devices are signed out.')).toBeVisible()
    await expect(page.getByLabel('Current password')).toHaveValue('')

    // This session stays signed in.
    await page.reload()
    await expect(page).toHaveURL('/account')
    await expect(page.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible()

    // The other session is signed out.
    await otherPage.goto('/account')
    await expect(otherPage).toHaveURL(/\/sign-in/)
    await otherContext.close()

    await signOut(page)

    // The old password no longer signs in.
    await submitSignIn(page, email, oldPassword)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in/)

    // The new one does.
    await signIn(page, email, newPassword)
    await page.goto('/account')
    await expect(page).toHaveURL('/account')
  })

  test('a wrong current password shows translated copy and returns focus to the button', async ({
    page,
  }) => {
    await signUpWithHousehold(page)

    await page.goto('/account')
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
