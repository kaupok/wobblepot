'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const HOUSEHOLD_TABS = [
  { href: '/household/household', label: 'Household' },
  { href: '/household/members', label: 'Members' },
]

export function HouseholdNav() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-4 border-b pb-4">
      {HOUSEHOLD_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            'text-sm font-medium transition-colors',
            pathname === tab.href ? 'text-primary' : 'text-muted-foreground hover:text-primary',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
