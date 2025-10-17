'use client'

import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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
        className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all data-[show=true]:scale-100 data-[show=true]:rotate-0"
        data-show={String(theme === 'light')}
      />
      <Moon
        className="absolute h-[1.2rem] w-[1.2rem] scale-0 -rotate-90 transition-all data-[show=true]:scale-100 data-[show=true]:rotate-0"
        data-show={String(theme === 'dark')}
      />
      <Monitor
        className="absolute h-[1.2rem] w-[1.2rem] scale-0 transition-all data-[show=true]:scale-100"
        data-show={String(theme === 'system')}
      />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
