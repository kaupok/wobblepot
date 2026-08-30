// ROUTES: /sign-up, /onboarding, /profile, /sign-in, / · COMPONENTS: DeleteAccountDialog, ProfilePage, SignInForm, Header (User menu)
import { test, expect, type Page } from '@playwright/test'
import { signUpWithHousehold } from './utils/test-helpers'
import {
  expirePurgeWindow,
  fetchHouseholdState,
  fetchUserState,
  runPurgeCron,
  type UserState,
} from './utils/e2e-support'
import { canReadEmail, findRecentEmail } from './utils/mail-helpers'

/**
 * Account deletion end-to-end against the HON-481 grace window (HON-479).
 *
 * **NOT `@smoke`, and it must stay that way.** It signs up a throwaway account
 * via `/api/e2e-seed` (404 on preview and staging), it needs the `/api/e2e-support`
 * back-channel for DB assertions, and it hard-deletes rows — none of which
 * belongs on a shared environment. `scripts/check-smoke-specs.sh` enforces the
 * first half of that; the rest is this comment plus the tag's absence.
 *
 * What it proves, in order:
 *  1. Deleting from `/profile` soft-deletes — the session is gone, but the
 *     user row, household, and household data survive the grace window.
 *  2. The user is told the exact purge date.
 *  3. A sign-in attempt with the deleted credentials fails *opaquely* — the
 *     same "invalid credentials" wording a wrong password gets. Asserting the
 *     absence of deletion-specific copy is the point: leaking account state to
 *     anyone holding the address is the failure mode HON-481 designed against.
 *  4. Once the window elapses, the real cron (real `CRON_SECRET`, no test-only
 *     branch in the route) runs the full cascade and nothing is left.
 */

const GRACE_WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** Copy that must never appear on a failed sign-in for a deleted account. */
const LEAKY_PHRASES = [/deleted/i, /deletion/i, /grace/i, /scheduled/i]

function expectWithinGraceWindow(state: UserState): void {
  expect(state.deletedAt, 'deletedAt should be stamped on soft-delete').not.toBeNull()
  expect(state.purgeScheduledFor, 'purgeScheduledFor should be stamped').not.toBeNull()

  const purgeAt = new Date(state.purgeScheduledFor!).getTime()
  const daysOut = (purgeAt - Date.now()) / DAY_MS
  // The route aligns the purge to the first 03:00 UTC cron run at or after
  // now + 30 days, so the window is 30 days plus up to one cron interval.
  expect(daysOut).toBeGreaterThanOrEqual(GRACE_WINDOW_DAYS - 0.01)
  expect(daysOut).toBeLessThanOrEqual(GRACE_WINDOW_DAYS + 1.01)
}

test.describe('Account deletion (grace window)', () => {
  test.setTimeout(90_000)

  test('soft-deletes with a 30-day window, blocks sign-in opaquely, then the cron purges', async ({
    page,
  }) => {
    const requestedAt = new Date()
    const { email, password } = await signUpWithHousehold(page, {
      householdName: 'Deletion Test Household',
    })

    // Baseline: a live account with its household intact.
    const before = await fetchUserState(email)
    expect(before.exists).toBe(true)
    expect(before.deletedAt).toBeNull()
    expect(before.memberships).toBe(1)
    expect(before.households).toBe(1)

    await page.goto('/profile')
    await page.getByRole('button', { name: 'Delete account' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete account' }).click()

    // The user is told when the account actually disappears. In tier 1 there is
    // no mail provider, so the toast is the only channel carrying that date —
    // it is rendered from the same `purgeScheduledFor` the email quotes.
    const toast = page.getByText(/Account scheduled for deletion on /)
    await expect(toast).toBeVisible()
    const toastText = (await toast.textContent()) ?? ''

    // Signed out everywhere, back on the public landing page.
    await page.waitForURL('/')
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()

    // Soft, not hard: the row and the household survive the window.
    const soft = await fetchUserState(email)
    expect(soft.exists).toBe(true)
    expectWithinGraceWindow(soft)
    expect(soft.sessions, 'all sessions should be invalidated on soft-delete').toBe(0)
    expect(soft.memberships, 'household membership survives until the purge').toBe(1)
    expect(soft.households, 'the household itself survives until the purge').toBe(1)

    // The toast date and the stored purge instant agree (both formatted in UTC).
    const purgeDay = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(new Date(soft.purgeScheduledFor!))
    expect(toastText).toContain(purgeDay)

    // Optional, and only where mail is actually sent: the confirmation email
    // names the same purge date. Tier 1 has no RESEND_API_KEY, so no email is
    // produced there at all — asserting unconditionally would be asserting on
    // a code path that never ran.
    if (canReadEmail()) {
      const message = await findRecentEmail({
        recipient: email,
        subjectPattern: /account will be deleted on/i,
        sentAfter: requestedAt,
      })
      expect(message, 'No account-deletion confirmation email arrived').not.toBeNull()
      const purgeDateGB = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(soft.purgeScheduledFor!))
      expect(message!.subject).toContain(purgeDateGB)
      expect(`${message!.html ?? ''}${message!.text ?? ''}`).toContain(purgeDateGB)
    }

    // Sign-in is refused, and refused without saying why.
    const softDeletedError = await attemptSignIn(page, email, password)
    for (const phrase of LEAKY_PHRASES) {
      expect(
        softDeletedError,
        `Sign-in error leaked deletion state: "${softDeletedError}". HON-481 requires an opaque credential failure.`,
      ).not.toMatch(phrase)
    }
    expect(softDeletedError).toMatch(/invalid|incorrect/i)

    // Fast-forward past the grace window and let the real cron do the work —
    // the production route, the real bearer secret, no test-only branch.
    await expirePurgeWindow(email)
    const { purged } = await runPurgeCron()
    expect(purged).toBeGreaterThanOrEqual(1)

    // Full cascade: the user row is gone, and so is the household it owned
    // (with its meal plan and pantry rows) — checked household-side, because
    // once the user is deleted there is nothing left to join through.
    const after = await fetchUserState(email)
    expect(after.exists, 'the user row should be hard-deleted by the purge').toBe(false)

    for (const householdId of soft.householdIds) {
      const household = await fetchHouseholdState(householdId)
      expect(household.exists, `household ${householdId} survived the purge`).toBe(false)
      expect(household.members).toBe(0)
      expect(household.pantryItems).toBe(0)
      expect(household.mealPlans).toBe(0)
    }

    // The strongest form of "opaque": a purged account and a soft-deleted one
    // are indistinguishable from outside — identical error, character for
    // character. A future regression that special-cases either state fails here.
    const purgedError = await attemptSignIn(page, email, password)
    expect(purgedError).toBe(softDeletedError)
  })
})

/** Submits the sign-in form and returns the form-level error text. */
async function attemptSignIn(page: Page, email: string, password: string): Promise<string> {
  await page.goto('/sign-in')
  await page.locator('input#email').fill(email)
  await page.locator('input#password').fill(password)
  await page.locator('form button[type="submit"]').click()

  // `#form-error` rather than role=alert: Next's route announcer also carries
  // role="alert", and the id is copy- and locale-stable.
  const error = page.locator('#form-error')
  await expect(error).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in/)
  return ((await error.textContent()) ?? '').trim()
}
