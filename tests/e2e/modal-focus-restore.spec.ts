import { test, expect } from '@playwright/test'
import { signUpWithHousehold } from './utils/test-helpers'

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
})
