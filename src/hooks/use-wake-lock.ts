'use client'

import { useEffect } from 'react'

/**
 * Keeps the screen on while `active` (HON-932): the cook view is read from a
 * counter between tasks, and a phone that dims after 30 seconds has to be
 * woken with a floury knuckle.
 *
 * Holds a `screen` wake lock while `active` and the page is visible. The
 * browser releases the lock itself when the tab is hidden, so it is requested
 * again each time the page becomes visible. Released when `active` turns false
 * and on unmount.
 *
 * Best effort and silent: where `navigator.wakeLock` is missing (Firefox
 * before 126, older Safari) it does nothing, and a refused request (battery
 * saver, a permissions policy) is swallowed — there is nothing for the user to
 * act on, so no toast and no console error.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let disposed = false

    const request = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const next = await navigator.wakeLock.request('screen')
        // Deactivated while the request was in flight: give it straight back.
        if (disposed) {
          await next.release()
          return
        }
        sentinel = next
      } catch {
        // Refused or unsupported in this context. Best effort: stay silent.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void request()
    }

    void request()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sentinel?.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}
