'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
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
        <span className="h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">{t('toggleTheme')}</span>
      </Button>
    )
  }

  return (
    <Button variant="outline" size="icon" onClick={toggleTheme} className="relative">
      <Sun
        className={cn(
          'absolute h-[1.2rem] w-[1.2rem] transition-all',
          resolvedTheme === 'light' ? 'scale-100 rotate-0' : 'scale-0 rotate-90',
        )}
      />
      <Moon
        className={cn(
          'absolute h-[1.2rem] w-[1.2rem] transition-all',
          resolvedTheme === 'dark' ? 'scale-100 -rotate-0' : 'scale-0 -rotate-90',
        )}
      />
      <span className="sr-only">{t('toggleTheme')}</span>
    </Button>
  )
}
