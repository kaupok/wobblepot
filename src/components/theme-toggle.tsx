'use client'

import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const cycleTheme = () => {
    if (theme === 'system') {
      setTheme('light')
    } else if (theme === 'light') {
      setTheme('dark')
    } else {
      setTheme('system')
    }
  }

  return (
    <Button variant="outline" size="icon" onClick={cycleTheme} className="relative">
      <Sun
        className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all data-[show=true]:scale-100 data-[show=true]:rotate-0"
        data-show={theme === 'light'}
      />
      <Moon
        className="absolute h-[1.2rem] w-[1.2rem] scale-0 -rotate-90 transition-all data-[show=true]:scale-100 data-[show=true]:rotate-0"
        data-show={theme === 'dark'}
      />
      <Monitor
        className="absolute h-[1.2rem] w-[1.2rem] scale-0 transition-all data-[show=true]:scale-100"
        data-show={theme === 'system'}
      />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
