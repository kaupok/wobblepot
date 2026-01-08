'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'

type Theme = 'light' | 'dark'

// Map themes to their color values
// These should match the background colors defined in globals.css
const THEME_COLORS: Record<Theme, string> = {
  light: '#ffffff', // oklch(1 0 0) - white background in light mode
  dark: '#1a1a1a', // oklch(0.145 0 0) - nearly black background in dark mode
} as const

const emptySubscribe = () => () => {}

/**
 * Hook to update the meta theme-color tag based on the current theme
 * This provides proper visual feedback in browser UI (tab bars, address bars, etc.)
 */
export function useThemeColor() {
  const { theme, systemTheme } = useTheme()
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  useEffect(() => {
    // Only run on the client after hydration
    if (!isMounted) return

    try {
      // Determine the effective theme (handles "system" theme)
      const effectiveTheme: Theme = theme === 'system' ? (systemTheme as Theme) : (theme as Theme)
      const color = THEME_COLORS[effectiveTheme] ?? THEME_COLORS.light

      // Update or create the meta theme-color tag
      let metaThemeColor = document.querySelector('meta[name="theme-color"]')
      if (!metaThemeColor) {
        metaThemeColor = document.createElement('meta')
        metaThemeColor.setAttribute('name', 'theme-color')
        document.head.appendChild(metaThemeColor)
      }
      metaThemeColor.setAttribute('content', color)
    } catch (error) {
      // Silently fail in production, log in development
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.error('Failed to update theme-color meta tag:', error)
      }
    }
  }, [theme, systemTheme, isMounted])
}
