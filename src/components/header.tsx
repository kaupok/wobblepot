'use client'

import { ThemeToggle } from '@/components/theme-toggle'

export function Header() {
  return (
    <header className="border-b">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Honkadori</h1>
        </div>
        <ThemeToggle />
      </div>
    </header>
  )
}
