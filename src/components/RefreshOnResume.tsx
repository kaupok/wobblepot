'use client'

import { useIsMutating } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import { getTodayInTimezone } from '@/lib/meal-planning/dates'

/** Away this long, other members have likely changed the plan or the list. */
const LONG_ABSENCE_MS = 10 * 60 * 1000

/**
 * The midnight timer never waits longer than this. The wait is counted on the
 * household's wall clock, which is an hour off across a DST change, so a tick
 * that finds the same date just schedules the next one.
 */
const MAX_TICK_MS = 60 * 60 * 1000

/** Milliseconds from `now` to the next midnight on the household's wall clock. */
function msUntilMidnight(timezone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const elapsed =
    ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + now.getMilliseconds()
  return 24 * 60 * 60 * 1000 - elapsed
}

/**
 * Re-runs the Server Components when the app comes back after a new household
 * day or a long absence, and at the household's midnight while it stays open
 * (HON-1593). A home-screen app on iOS resumes without a reload, so without
 * this, Today keeps showing yesterday.
 *
 * `router.refresh()` and not `invalidateQueries`: "today" is computed on the
 * server, so only a server render moves it. It keeps client state (scroll,
 * open sheets).
 */
export function RefreshOnResume({
  renderedDate,
  timezone,
}: {
  /** The household's `YYYY-MM-DD` when the server rendered the layout. */
  renderedDate: string
  timezone: string
}) {
  const router = useRouter()
  const mutating = useIsMutating()
  const lastDate = useRef(renderedDate)
  const mutatingNow = useRef(mutating)
  const pending = useRef(false)
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    lastDate.current = renderedDate
  }, [renderedDate])

  // A refresh mid-save would flicker the half-saved edit, so it waits.
  const refresh = useCallback(() => {
    if (mutatingNow.current > 0) {
      pending.current = true
      return
    }
    pending.current = false
    lastDate.current = getTodayInTimezone(timezone)
    router.refresh()
  }, [router, timezone])

  useEffect(() => {
    mutatingNow.current = mutating
    if (mutating === 0 && pending.current) refresh()
  }, [mutating, refresh])

  useEffect(() => {
    const isNewDay = () => getTodayInTimezone(timezone) !== lastDate.current
    let timer: ReturnType<typeof setTimeout> | undefined

    // iOS pauses timers in a suspended app, so the resume check covers that case.
    const schedule = () => {
      clearTimeout(timer)
      const wait = Math.min(msUntilMidnight(timezone, new Date()) + 1000, MAX_TICK_MS)
      timer = setTimeout(() => {
        if (isNewDay()) refresh()
        schedule()
      }, wait)
    }

    const onResume = () => {
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current
      hiddenAt.current = null
      if (away >= LONG_ABSENCE_MS || isNewDay()) refresh()
      schedule()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        onResume()
        return
      }
      hiddenAt.current ??= Date.now()
      clearTimeout(timer)
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onResume()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    if (document.visibilityState === 'visible') schedule()

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
      clearTimeout(timer)
    }
  }, [refresh, timezone])

  return null
}
