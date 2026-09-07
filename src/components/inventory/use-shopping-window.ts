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
 * Applies the stored 7/14-day preference to the URL after mount.
 *
 * `/shopping` derives its window from `?days=` (`src/app/shopping/page.tsx`),
 * which the server can read and `localStorage` is not. A stored preference
 * therefore only takes effect by navigating to the URL that encodes it, which
 * is what this does when a visit arrives without the param.
 *
 * **Call it from `InventoryPage` and nowhere else.** That is the one component
 * that renders on every `/shopping` visit and renders exactly once, so the
 * reconcile fires once per page and reaches every state — including `no-plan`
 * and `error`, which render no header and so no picker. `no-plan` in
 * particular is a state the *narrow* window can itself cause: `generatedAt` is
 * folded over plan entries already filtered to the window
 * (`src/lib/meal-planning/shopping-list.ts`), so a household whose entries fall
 * on days 8-14 is told "No meal plan yet" at `days=7`. Reading the saved `'14'`
 * is what gets them out of it, and it needs no header to do so.
 *
 * @param windowDays      the window the server rendered with
 * @param windowDaysFromUrl whether `?days=` said so explicitly, as opposed to
 *   being absent or unparseable. `page.tsx` collapses `/shopping`,
 *   `?days=7` and `?days=garbage` into the same `7`, so without this bit the
 *   effect cannot tell "the URL expressed no preference" from "the user is
 *   asking for this window" — and re-applies storage over both. That makes
 *   Back a no-op immediately after using the picker (the pushed entry is
 *   reconciled straight back in) and an explicit `?days=14` link unopenable
 *   for anyone who has ever chosen 7 days.
 */
export function useWindowReconcile(windowDays: number, windowDaysFromUrl: boolean) {
  const router = useRouter()

  useEffect(() => {
    // An explicit `?days=` is the user's immediate intent and outranks a
    // preference they set at some point in the past.
    if (windowDaysFromUrl) return

    const stored = getStoredWindowDays()
    if (stored === null || stored === windowDays) return

    // `replace`, not `push`. Every in-app entry to the list is a bare
    // `/shopping` (`bottom-tab-bar.tsx`, `navigation.tsx`, `UrgentShopping.tsx`,
    // and `/pantry`'s redirect), so a 14-day user is reconciled on every visit.
    // With `push` the pre-reconcile URL stays in history, and going Back to it
    // changes `windowDays` — which re-runs this effect and pushes forward
    // again. Back would never get past `/shopping`, and each attempt would add
    // another entry.
    router.replace(`/shopping?days=${stored}`)
  }, [windowDays, windowDaysFromUrl, router])
}

/**
 * The setter behind the window picker, for `ShoppingListHeader`.
 *
 * Uses `push` where the reconcile uses `replace`: this one is a navigation the
 * user asked for, so Back should undo it — and it can, because the URL it
 * produces is explicit and `useWindowReconcile` leaves explicit URLs alone.
 */
export function useSetWindowDays() {
  const router = useRouter()

  return useCallback(
    (value: string | number) => {
      const days = parseWindowDays(value)
      // Written before navigating: the next render reads it back on mount, and
      // that is what makes the choice survive a later visit with no `?days=`.
      localStorage.setItem(WINDOW_STORAGE_KEY, String(days))
      router.push(`/shopping?days=${days}`)
    },
    [router],
  )
}
