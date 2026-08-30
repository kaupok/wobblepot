// ROUTES: /forgot-password, /reset-password, /sign-in · COMPONENTS: ForgotPasswordForm, ResetPasswordForm, SignInForm, Header (User menu)
import { test, expect, type Page } from '@playwright/test'
import { signIn, signOut } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { forgotPasswordFixture, generateStrongPassword } from './utils/fixtures'
import { canReadEmail, resolveResetUrl } from './utils/mail-helpers'

/**
 * Forgot password → reset → sign in (HON-479).
 *
 * `@smoke` and pattern (b) (HON-560): the spec never signs up an account, it
 * only drives the dedicated `FORGOT_PASSWORD_TEST_EMAIL` fixture that
 * `prisma/seed.ts` plants. That account exists precisely so its password can
 * churn without touching the smoke account other specs sign in with.
 *
 * **Idempotency:** the run ends by putting the original password back via
 * `POST /api/auth/change-password` (one authenticated call — cheaper and less
 * flaky than a second email round-trip). The restore also runs from `finally`,
 * so a mid-test failure still leaves the fixture usable for the next run.
 *
 * **Where the reset link comes from** depends on the tier — see
 * `utils/mail-helpers.ts`. Preview/staging read it from Resend
 * (`RESEND_TEST_API_KEY`); tier 1 CI and local runs, which have no mail
 * provider configured at all, read the token from the test-only back-channel.
 * With neither available the test skips rather than fails: a hard failure
 * would redden the production-promotion gate on every merge until someone
 * mints the Resend key (the HON-560 failure mode).
 *
 * The fixture account deliberately has no household (only the smoke user gets
 * one), so signed-in assertions here use the session endpoint and the header
 * user menu — `/profile` would bounce to `/onboarding`.
 */

/**
 * Better Auth's origin check rejects any cookie-bearing POST that arrives
 * without an `Origin` header (`MISSING_OR_NULL_ORIGIN` → 403), and Playwright's
 * APIRequestContext sends none. Stamp the app's own origin — the value
 * `trustedOrigins` is built from (`src/lib/auth.ts` → `getServerBaseURL()`) —
 * so the request looks like the browser call it stands in for.
 */
function changePasswordRequest(data: { currentPassword: string; newPassword: string }) {
  return { data, headers: { origin: e2eBaseURL() } }
}

async function expectSignedInAs(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible()
  const session = await page.request.get('/api/auth/get-session')
  expect(session.ok()).toBe(true)
  const body = (await session.json()) as { user?: { email?: string } } | null
  expect(body?.user?.email).toBe(email)
}

test.describe('Forgot password', { tag: '@smoke' }, () => {
  test('request reset → set a new password → sign in with it', async ({ page }) => {
    const { email, password: originalPassword } = forgotPasswordFixture()
    const newPassword = generateStrongPassword()

    // Pre-grant cookie consent so the bottom-fixed CookieBanner never
    // intercepts clicks — same rationale as signUp() in test-helpers.
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])

    // Bound the mail search to this run so a reset link from a previous run
    // against the same shared inbox can't satisfy the assertion.
    const requestedAt = new Date()

    await page.goto('/forgot-password')
    await page.locator('input#email').fill(email)
    await page.locator('form button[type="submit"]').click()

    // The form reports success for unknown addresses too (anti-enumeration),
    // so this only proves the request was accepted — the real proof is that a
    // usable token comes back below.
    await expect(page.getByRole('status')).toBeVisible()

    const resetUrl = await resolveResetUrl({ email, requestedAt })
    // A readable inbox that yields no reset email is a delivery regression —
    // the exact failure this spec exists to catch — so it must fail, not skip.
    // Only the tiers with no way to read the link at all downgrade to a skip.
    if (resetUrl === null && canReadEmail()) {
      throw new Error(
        'RESEND_TEST_API_KEY is set but no reset email with a usable link arrived within the poll budget',
      )
    }
    test.skip(
      resetUrl === null,
      'No way to read the reset link on this tier: set RESEND_TEST_API_KEY, or run where /api/e2e-support is enabled (E2E_DISABLE_RATE_LIMIT=1 + NEXT_PUBLIC_APP_ENV of ci/test/dev)',
    )

    let restored = false
    try {
      // Follow the real Better Auth callback (/api/auth/reset-password/:token),
      // which validates the token and redirects to /reset-password?token=… —
      // the same hop a user clicking the email makes.
      await page.goto(resetUrl!)
      await expect(page).toHaveURL(/\/reset-password\?.*token=/)

      await page.locator('input#newPassword').fill(newPassword)
      await page.locator('input#confirmPassword').fill(newPassword)
      await page.locator('form button[type="submit"]').click()

      // The form redirects to /sign-in?reset=success, but SignInForm strips the
      // param with `router.replace` as soon as it renders the banner — asserting
      // the URL is a race. Assert the banner itself: it is both the stable
      // signal and the thing the user actually sees.
      await expect(page.getByRole('status')).toContainText(/password has been reset/i)
      await expect(page).toHaveURL(/\/sign-in/)

      // The reset actually took: the new password authenticates.
      await signIn(page, email, newPassword)
      await expectSignedInAs(page, email)

      // Restore while the session from the new password is still live.
      const restore = await page.request.post(
        '/api/auth/change-password',
        changePasswordRequest({
          currentPassword: newPassword,
          newPassword: originalPassword,
        }),
      )
      expect(
        restore.ok(),
        `Failed to restore the fixture password (status ${restore.status()}). ` +
          'The FORGOT_PASSWORD_TEST_PASSWORD fixture is now stale — re-run the seed.',
      ).toBe(true)
      restored = true

      // Prove the restore rather than trusting the 200: change-password leaves
      // the current session valid, so only a fresh sign-in shows which password
      // the account actually holds now.
      await signOut(page)
      await signIn(page, email, originalPassword)
      await expectSignedInAs(page, email)
    } finally {
      // Best-effort recovery when the body failed after the password changed:
      // without this the fixture would carry a random password into every
      // later run. Swallows errors — the real failure is already reported.
      if (!restored) {
        await page.request
          .post(
            '/api/auth/change-password',
            changePasswordRequest({
              currentPassword: newPassword,
              newPassword: originalPassword,
            }),
          )
          .catch(() => {})
      }
    }
  })
})
