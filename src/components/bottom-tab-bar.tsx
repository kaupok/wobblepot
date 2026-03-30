'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, Home, ShoppingCart, Users } from 'lucide-react'
import type { Session } from '@/lib/auth'

const tabs = [
  { label: 'Today', icon: Home, href: '/' },
  { label: 'Shopping', icon: ShoppingCart, href: '/shopping' },
  { label: 'Recipes', icon: BookOpen, href: '/recipes' },
  { label: 'Household', icon: Users, href: '/household' },
] as const

interface BottomTabBarProps {
  session: Session | null
  hasHousehold: boolean
}

export function BottomTabBar({ session, hasHousehold }: BottomTabBarProps) {
  const pathname = usePathname()

  if (!session || !hasHousehold) return null

  return (
    <nav
      className="bg-background/80 fixed right-0 bottom-0 left-0 z-50 border-t backdrop-blur-lg md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex h-16 items-center justify-around">
        {tabs.map(({ label, icon: Icon, href }) => {
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
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
