'use client'

import { useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** The only definition. Stories and tests import it rather than re-declaring it. */
export const WINDOW_STORAGE_KEY = 'shopping-list-window-days'

export type WindowDays = 7 | 14

/**
 * Coerce a picker value to a window. The `Select` can only emit `'7'` or
 * `'14'`, so anything else is a bug upstream and lands on the default rather
 * than routing to a window the API would reject with a 400
 * (`src/app/api/shopping-list/route.ts:46`).
 *
 * Deliberately *not* used to read storage — see `getStoredWindowDays`.
 */
export function parseWindowDays(value: string | number | null | undefined): WindowDays {
  return String(value) === '14' ? 14 : 7
}

/**
 * The persisted preference, or `null` when there isn't one.
 *
 * The null case is load-bearing: "no preference" is not the same as "chose 7".
 * Collapsing them makes the reconcile below override an explicit `?days=14`
 * for every user who has never touched the picker — a bookmark or a shared
 * link would bounce straight back to the 7-day window. An unrecognised value
 * is treated the same way; it is not a choice the user made either.
 *
 * Returns `null` on the server so SSR and the first client render agree; the
 * real value is reconciled after mount.
 */
export function getStoredWindowDays(): WindowDays | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(WINDOW_STORAGE_KEY)
  if (stored !== '7' && stored !== '14') return null
  return stored === '14' ? 14 : 7
}

/**
 * Owns the 7/14-day shopping window: the stored preference, the mount-time
 * reconcile against the `?days=` param the server rendered with, and the
 * setter behind the picker.
 *
 * `/shopping` derives its window from `?days=` (`src/app/shopping/page.tsx`),
 * so a stored preference only takes effect by navigating to the URL that
 * encodes it — which is what the reconcile does when a visit arrives without
 * the param, or with one that disagrees.
 *
 * Called by `ShoppingListHeader` rather than by the two branch components, so
 * it runs exactly once per page: `ShoppingSection` returns `ShoppingEmptyState`
 * before rendering its own header, and calling the hook in both would fire the
 * reconcile twice on that path.
 */
export function useShoppingWindow(windowDays: number) {
  const router = useRouter()

  useEffect(() => {
    const stored = getStoredWindowDays()
    if (stored === null || stored === windowDays) return

    // `replace`, not `push`. Every in-app entry to the list is a bare
    // `/shopping` (`bottom-tab-bar.tsx`, `navigation.tsx`, `UrgentShopping.tsx`,
    // and `/pantry`'s redirect), so a 14-day user is reconciled on every visit.
    // With `push` the pre-reconcile URL stays in history, and going Back to it
    // changes `windowDays` — which re-runs this effect and pushes forward
    // again. Back would never get past `/shopping`, and each attempt would add
    // another entry. `setWindowDays` keeps `push`: that one is a navigation the
    // user asked for and belongs in history.
    router.replace(`/shopping?days=${stored}`)
  }, [windowDays, router])

  const setWindowDays = useCallback(
    (value: string | number) => {
      const days = parseWindowDays(value)
      // Written before navigating: the next render reads it back on mount, and
      // that is what makes the choice survive a later visit with no `?days=`.
      localStorage.setItem(WINDOW_STORAGE_KEY, String(days))
      router.push(`/shopping?days=${days}`)
    },
    [router],
  )

  return { setWindowDays }
}
