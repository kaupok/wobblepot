'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'

const emptySubscribe = () => () => {}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const t = useTranslations('nav.actions')
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  if (!mounted) {
    return (
      <Button variant="outline" size="icon" className="relative">
        <span className="size-4" />
        <span className="sr-only">{t('toggleTheme')}</span>
      </Button>
    )
  }

  return (
    <Button variant="outline" size="icon" onClick={toggleTheme} className="relative">
      {/* Theme switches snap (docs/DESIGN.md → Motion): one icon, swapped
          without animating. */}
      {resolvedTheme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
      <span className="sr-only">{t('toggleTheme')}</span>
    </Button>
  )
}
