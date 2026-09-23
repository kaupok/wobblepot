'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'

const emptySubscribe = () => () => {}

/**
 * The labelled theme control shared by the desktop user menu and the mobile
 * account sheet (HON-775), so the two cannot drift. Until mount the resolved
 * theme is unknown, so the label falls back to the neutral "Toggle theme".
 */
export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const t = useTranslations('nav.actions')
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  const isDark = mounted && resolvedTheme === 'dark'
  const label = mounted ? (isDark ? t('lightMode') : t('darkMode')) : t('toggleTheme')
  const toggle = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')

  return { isDark, label, toggle }
}
