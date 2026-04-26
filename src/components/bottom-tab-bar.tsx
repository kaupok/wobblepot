'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, Home, ShoppingCart, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Session } from '@/lib/auth'

const tabs = [
  { key: 'today', icon: Home, href: '/' },
  { key: 'shopping', icon: ShoppingCart, href: '/shopping' },
  { key: 'recipes', icon: BookOpen, href: '/recipes' },
  { key: 'household', icon: Users, href: '/household' },
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
      className="bg-background/80 fixed right-0 bottom-0 left-0 z-50 border-t backdrop-blur-lg md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex h-16 items-center justify-around">
        {tabs.map(({ key, icon: Icon, href }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)

          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              {t(key)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
