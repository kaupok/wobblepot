// ROUTES: /sign-up, /onboarding, /forgot-password, /reset-password, /sign-in · COMPONENTS: ForgotPasswordForm, ResetPasswordForm, SignInForm
import { test, expect } from '@playwright/test'
import { signIn, signUpWithHousehold } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { generateStrongPassword } from './utils/fixtures'
import { canReadEmail, resolveResetUrl } from './utils/mail-helpers'

/**
 * Forgot password for a user whose household locale is `et` (HON-704).
 *
 * `forgot-password.spec.ts` drives a seeded fixture with no household, so its
 * reset email always resolves to English. This spec covers the other shape:
 * the household exists and is Estonian, so the reset email is sent with the
 * Estonian subject (HON-513) — the case that broke a helper which matched on
 * `Reset your … password`. `resolveResetUrl` now selects by the reset link, and
 * the Estonian-subject path through Resend is unit-tested in
 * `utils/mail-helpers.test.ts`.
 *
 * **NOT `@smoke`:** it signs up a throwaway account through `/api/e2e-seed`,
 * which 404s on preview and staging (`scripts/check-smoke-specs.sh`). On tier 1
 * the link comes from the `/api/e2e-support` back-channel.
 *
 * Every selector is an id or a `data-testid`: the whole flow renders in
 * Estonian, so role-by-name queries on English copy would miss.
 */

test.describe('Forgot password (Estonian household)', () => {
  test.use({ locale: 'et-EE' })

  test('request reset → set a new password → sign in with it', async ({ page }) => {
    const { email } = await signUpWithHousehold(page)
    // The Accept-Language-resolved `et` round-trips into `Household.locale`
    // (HON-549), and the chrome only stays Estonian once the household row
    // exists if it did — the same proof `i18n-smoke.spec.ts` uses.
    await expect(page.locator('html')).toHaveAttribute('lang', 'et')

    // Sign out by dropping the session: the header sign-out helper queries
    // English accessible names. Re-grant consent so the banner stays hidden.
    await page.context().clearCookies()
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])

    const requestedAt = new Date()

    await page.goto('/forgot-password')
    await page.locator('input#email').fill(email)
    await page.locator('form button[type="submit"]').click()
    await expect(page.getByTestId('form-success')).toBeVisible()

    const resetUrl = await resolveResetUrl({ email, requestedAt })
    if (resetUrl === null && canReadEmail()) {
      throw new Error(
        'RESEND_TEST_API_KEY is set but no reset email with a usable link arrived within the poll budget',
      )
    }
    test.skip(
      resetUrl === null,
      'No way to read the reset link on this tier: set RESEND_TEST_API_KEY, or run where /api/e2e-support is enabled',
    )

    await page.goto(resetUrl!)
    await expect(page).toHaveURL(/\/reset-password\?.*token=/)

    const newPassword = generateStrongPassword()
    await page.locator('input#newPassword').fill(newPassword)
    await page.locator('input#confirmPassword').fill(newPassword)
    await page.locator('form button[type="submit"]').click()

    await expect(page.getByTestId('form-success')).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in/)

    // The reset took: the new password authenticates as this user.
    await signIn(page, email, newPassword)
    const session = await page.request.get('/api/auth/get-session')
    expect(session.ok()).toBe(true)
    const body = (await session.json()) as { user?: { email?: string } } | null
    expect(body?.user?.email).toBe(email)
  })
})
