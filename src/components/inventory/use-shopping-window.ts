'use client'

import { useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** The only definition. Stories and tests import it rather than re-declaring it. */
export const WINDOW_STORAGE_KEY = 'shopping-list-window-days'

export type WindowDays = 7 | 14

/** Anything that isn't an explicit 14 is the 7-day default. */
export function parseWindowDays(value: string | number | null | undefined): WindowDays {
  return String(value) === '14' ? 14 : 7
}

/**
 * Read the persisted window. Returns 7 on the server so SSR and the first
 * client render agree; the real value is reconciled after mount.
 */
export function getStoredWindowDays(): WindowDays {
  if (typeof window === 'undefined') return 7
  return parseWindowDays(localStorage.getItem(WINDOW_STORAGE_KEY))
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
    if (stored !== windowDays) {
      router.push(`/shopping?days=${stored}`)
    }
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
