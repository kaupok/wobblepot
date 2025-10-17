'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { useThemeColor } from '@/hooks/use-theme-color'

type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>

function ThemeColorUpdater() {
  useThemeColor()
  return null
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <ThemeColorUpdater />
      {children}
    </NextThemesProvider>
  )
}
