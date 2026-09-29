// ROUTES: /profile, /, /sign-in · COMPONENTS: DeleteAccountDialog, AlertDialogTrigger, TimelineEmptySlot, MealSelectorModal
import { test, expect } from '@playwright/test'
import { signIn, signUpWithHousehold } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

// WHY: Focus-restore is a Radix Dialog/AlertDialog contract that depends on a
// real trigger and a real `.focus()` call, neither of which can be reliably
// simulated in the Storybook test-runner (see HON-443, HON-445). One Playwright
// test covers the invariant for all Radix modals in the app — this is not
// per-modal behaviour, so we don't replicate it for each dialog.
//
// The profile page's `DeleteAccountDialog` is chosen as the target because it
// is the most durable trigger/modal pair in the app: static UI (no AI, no
// generated content), reachable immediately after onboarding, and uses a plain
// `<AlertDialogTrigger>` pattern that doesn't risk re-rendering the trigger
// node when the dialog opens. The meal-card → `MealDetailModal` flow suggested
// in the original issue was rejected for this test because it depends on AI
// meal-plan generation, which is a real-world source of flakiness in CI.
test.describe('Modal focus-restore', () => {
  test('focus returns to the originating trigger after Escape-close', async ({ page }) => {
    await signUpWithHousehold(page)

    await page.goto('/profile')

    const trigger = page.getByRole('button', { name: 'Delete account' })
    await expect(trigger).toBeVisible()

    // Focus before click so Radix's FocusScope captures the trigger as the
    // element to restore focus to when the dialog closes. `click()` gives focus
    // in Chromium, but being explicit removes any race between the focus event
    // and Radix's mount-time activeElement snapshot.
    await trigger.focus()
    await expect(trigger).toBeFocused()

    await trigger.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-state', 'open')

    // Close via Escape — the Radix path that must restore focus.
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()

    // The Radix contract: focus returns to the element that had it when the
    // dialog opened.
    await expect(trigger).toBeFocused()
  })

  // Not covered by the Radix contract above: the meal selector opens
  // programmatically once "Pick a meal" has created a placeholder entry, with
  // no `DialogTrigger`, and a modal Radix dialog restores focus only to its
  // trigger. The slot hands it to its own button instead, which is still
  // pending (the placeholder DELETE is in flight), so the button must be
  // `aria-disabled` rather than `disabled` to take it (HON-803).
  //
  // Signs in as the seeded smoke fixture, whose household has a plan, so Today
  // renders empty slots with no AI plan generation (a fresh sign-up has no
  // plan). The selector's `/suggestions` call is a DB query, not an AI one.
  // Not `@smoke`: this file imports `signUpWithHousehold`, which
  // `scripts/check-smoke-specs.sh` rejects in a `@smoke` file.
  test('focus returns to "Pick a meal" after the empty-slot selector is dismissed', async ({
    page,
  }) => {
    const { email, password } = smokeFixture()

    // Pre-grant consent so the CookieBanner cannot take focus or clicks.
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])
    await signIn(page, email, password)
    await page.goto('/')

    // The first empty slot is Today's: the seed plans nothing on the smoke
    // household, and past days hide their empty slots. The spec that
    // shares this household, shopping-to-pantry, only touches today + 2 lunch,
    // which a Today slot never is.
    const trigger = page.getByRole('button', { name: 'Pick a meal' }).first()
    await expect(trigger).toBeVisible()

    let entryPath: string | null = null
    let discarded = false

    try {
      await trigger.focus()
      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            /^\/api\/meal-plans\/[^/]+\/entries$/.test(new URL(r.url()).pathname),
        ),
        page.keyboard.press('Enter'),
      ])
      expect(
        createResponse.ok(),
        `Creating the placeholder failed with ${createResponse.status()}`,
      ).toBe(true)
      const { id } = (await createResponse.json()) as { id: string }
      entryPath = `${new URL(createResponse.url()).pathname}/${id}`

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname === entryPath,
        ),
        page.keyboard.press('Escape'),
      ])
      discarded = deleteResponse.ok()
      await expect(dialog).toBeHidden()

      await expect(trigger).toBeFocused()
    } finally {
      // The close deletes the placeholder; clear it here only if it did not.
      if (entryPath && !discarded) {
        await page.request.delete(entryPath).catch(() => {})
      }
    }
  })
})
