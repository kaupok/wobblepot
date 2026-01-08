'use client'

import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const emptySubscribe = () => () => {}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  const cycleTheme = () => {
    if (theme === 'system') {
      setTheme('light')
    } else if (theme === 'light') {
      setTheme('dark')
    } else {
      setTheme('system')
    }
  }

  if (!mounted) {
    return (
      <Button variant="outline" size="icon" className="relative">
        <Monitor className="h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">Toggle theme</span>
      </Button>
    )
  }

  return (
    <Button variant="outline" size="icon" onClick={cycleTheme} className="relative">
      <Sun
        className={cn(
          'absolute h-[1.2rem] w-[1.2rem] transition-all',
          theme === 'light' ? 'scale-100 rotate-0' : 'scale-0 rotate-90',
        )}
      />
      <Moon
        className={cn(
          'absolute h-[1.2rem] w-[1.2rem] transition-all',
          theme === 'dark' ? 'scale-100 -rotate-0' : 'scale-0 -rotate-90',
        )}
      />
      <Monitor
        className={cn(
          'absolute h-[1.2rem] w-[1.2rem] transition-all',
          theme === 'system' ? 'scale-100' : 'scale-0',
        )}
      />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
