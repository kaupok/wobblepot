/**
 * A one-shot signal from the first-plan Generate button to Today. On success
 * the button leaves the page with its screen (`FirstTimeSetup` is swapped for
 * `TimelineView`, or onboarding navigates to `/`), so focus falls to the body.
 * `TimelineView` reads the flag on mount and focuses its first day heading
 * (HON-1139). Removed on read, so a reload of Today does not move focus.
 *
 * Storage can throw (Safari private mode, blocked cookies). Focus is a nicety,
 * so a failure here never reaches the generation.
 */
const KEY = 'wobblepot:first-plan-focus'

export function markFirstPlanGenerated(): void {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    // No storage: focus falls to the body, as before.
  }
}

/** True once after `markFirstPlanGenerated`, and clears the flag. */
export function takeFirstPlanGenerated(): boolean {
  try {
    const marked = sessionStorage.getItem(KEY) !== null
    if (marked) sessionStorage.removeItem(KEY)
    return marked
  } catch {
    return false
  }
}
