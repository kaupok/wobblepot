'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, Home, Package, ShoppingCart } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Session } from '@/lib/auth'
import { isNavItemActive } from '@/lib/navigation'

// Four tabs, and a fifth is not an option (DESIGN.md → "Four tabs on a
// phone"). Household lives in the account sheet (HON-775), which is what freed
// the slot Pantry took (HON-776).
const tabs = [
  { key: 'today', icon: Home, href: '/' },
  { key: 'shopping', icon: ShoppingCart, href: '/shopping' },
  // `Package` rather than `Archive`: a box of stored goods reads as "what we
  // have in", where a filing box reads as old records put away.
  { key: 'pantry', icon: Package, href: '/pantry' },
  { key: 'recipes', icon: BookOpen, href: '/recipes' },
] as const

interface BottomTabBarProps {
  session: Session | null
  hasHousehold: boolean
}

export function BottomTabBar({ session, hasHousehold }: BottomTabBarProps) {
  const pathname = usePathname()
  const t = useTranslations('nav.tabs')

  if (!session || !hasHousehold) return null

  return (
    <nav
      aria-label={t('ariaLabel')}
      className="bg-background/80 fixed right-0 bottom-0 left-0 z-50 border-t pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-lg md:hidden"
    >
      <div className="flex h-16 items-center justify-around">
        {tabs.map(({ key, icon: Icon, href }) => {
          const isActive = isNavItemActive(href, pathname)

          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="size-6" />
              {t(key)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
