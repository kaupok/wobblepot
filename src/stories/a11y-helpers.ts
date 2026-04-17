import { expect, userEvent, waitFor, within } from 'storybook/test'

/**
 * Modal a11y play-function helpers.
 *
 * These assert the interaction invariants that axe (static a11y) cannot see:
 * focus trap on open, focus restore on close, tab order containment, Escape
 * handling. Radix Dialog content renders through a portal, so queries go
 * through `within(document.body)` rather than `canvasElement`.
 */

/**
 * Asserts focus has moved into the currently-open dialog after it opens.
 * Radix Dialog's focus-scope handles this — we're asserting the contract holds.
 */
export async function assertFocusInDialog(): Promise<void> {
  const body = within(document.body)
  const dialog = await body.findByRole('dialog')
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
}

/**
 * Waits for any open dialog to fully unmount. Our Radix Dialog has a 200ms
 * fade-out animation; during that time the dialog element remains in the DOM
 * with `data-state="closed"` and FocusScope stays mounted, so focus-restore
 * hasn't run yet. Awaiting unmount is a proxy for "close sequence completed"
 * and is what catches the real a11y regression (a dialog that never closes,
 * or whose focus trap outlives unmount).
 */
export async function awaitDialogClosed(timeoutMs = 2000): Promise<void> {
  await waitFor(
    () => {
      expect(document.querySelectorAll('[role="dialog"]').length).toBe(0)
    },
    { timeout: timeoutMs },
  )
}

/**
 * Tabs through `count` focusable elements and asserts focus never escapes the
 * open dialog. Default 10 cycles through any realistic modal's focusables at
 * least once.
 */
export async function assertTabStaysInDialog(count = 10): Promise<void> {
  const body = within(document.body)
  const dialog = await body.findByRole('dialog')
  for (let i = 0; i < count; i++) {
    await userEvent.keyboard('{Tab}')
    expect(dialog.contains(document.activeElement)).toBe(true)
  }
}

/** Presses Escape. Closes Radix dialogs and fires `onOpenChange(false)`. */
export async function pressEscape(): Promise<void> {
  await userEvent.keyboard('{Escape}')
}

/** Presses Tab `count` times. */
export async function pressTab(count = 1): Promise<void> {
  for (let i = 0; i < count; i++) {
    await userEvent.keyboard('{Tab}')
  }
}

/**
 * Asserts focus has been restored to the given trigger element after the
 * dialog closes.
 *
 * Note: Only reliable when the trigger is registered with Radix's
 * `<DialogTrigger>` context (e.g. `AddMemberDialog`). For a controlled-open
 * modal with an external trigger button, Radix's FocusScope captures
 * `document.activeElement` at mount time and can't always restore focus back
 * in the @storybook/test-runner (headless Chromium) environment — prefer
 * `awaitDialogClosed` as the close-sequence assertion for those.
 */
export async function assertFocusRestored(trigger: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(document.activeElement).toBe(trigger)
  })
}

/**
 * Focuses the trigger and activates it to open a dialog. We can't rely on
 * `.focus()` or mouse-click-induced focus in the test-runner env, so we use
 * keyboard Tab navigation (which consistently sets focus in Chromium) and
 * activate with Enter. Assumes the trigger is the first focusable element.
 */
export async function openViaTrigger(trigger: HTMLElement): Promise<void> {
  await userEvent.tab()
  await waitFor(() => {
    expect(document.activeElement).toBe(trigger)
  })
  await userEvent.keyboard('{Enter}')
}
