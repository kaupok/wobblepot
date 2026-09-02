'use client'

import { useEffect, useState } from 'react'

/**
 * Debounce a rapidly-changing value. The first value is returned immediately;
 * every later change waits `delayMs` of quiet before it propagates, so a burst
 * of keystrokes collapses into a single update.
 *
 * Pair with `useQuery` to keep a query key stable while the user types — see
 * `use-ingredient-search.ts`.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedValue(value), delayMs)
    return () => clearTimeout(timeout)
  }, [value, delayMs])

  return debouncedValue
}
