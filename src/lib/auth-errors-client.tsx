'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { getAuthErrorKey } from './auth-errors'

/**
 * Client-side hook that turns a raw Better Auth error message into a
 * localized, user-friendly string. Use inside auth forms.
 *
 * The returned function is memoized via `useCallback`, so callers can
 * safely list it in `useEffect` / `useCallback` deps without forcing
 * a render loop:
 *
 *   const friendly = useAuthErrorMessage()
 *   setError(friendly(ctx.error?.message ?? ''))
 *
 * Behavior:
 *   - empty input → `errors.auth.unexpected`
 *   - mapped keyword → `errors.auth.<key>`
 *   - unmapped → returns the original string (developer-facing fallback so
 *     never-seen-before backend errors aren't silently swallowed).
 */
export function useAuthErrorMessage(): (message: string) => string {
  const t = useTranslations('errors.auth')
  return useCallback(
    (message: string): string => {
      if (!message) return t('unexpected')
      const key = getAuthErrorKey(message)
      return key ? t(key) : message
    },
    [t],
  )
}
