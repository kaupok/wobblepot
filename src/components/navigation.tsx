'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { isNavItemActive } from '@/lib/navigation'
import { cn } from '@/lib/utils'

interface NavigationProps {
  isAuthenticated: boolean
  hasHousehold: boolean
}

/**
 * A header link that marks the current page. The underline is the non-colour
 * cue DESIGN.md asks for; `aria-current` carries the same signal to assistive
 * tech. Active-route matching is shared with `BottomTabBar`.
 */
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const isActive = isNavItemActive(href, pathname)

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'text-sm font-medium transition-colors',
        isActive
          ? 'text-foreground underline decoration-2 underline-offset-8'
          : 'text-muted-foreground hover:text-primary',
      )}
    >
      {children}
    </Link>
  )
}

/**
 * Left navigation - daily operational views
 * (Today, Pantry & shopping)
 */
export function NavigationLeft({ isAuthenticated, hasHousehold }: NavigationProps) {
  const t = useTranslations('nav.primary')

  if (!isAuthenticated || !hasHousehold) return null

  return (
    <nav aria-label={t('ariaLabel')} className="hidden items-center gap-6 md:flex">
      <NavLink href="/">{t('today')}</NavLink>
      <NavLink href="/shopping">{t('pantryAndShopping')}</NavLink>
    </nav>
  )
}

/**
 * Right navigation - settings/configuration views
 * (My recipes, Household)
 */
export function NavigationRight({ isAuthenticated, hasHousehold }: NavigationProps) {
  const t = useTranslations('nav.settings')

  if (!isAuthenticated || !hasHousehold) return null

  return (
    <nav aria-label={t('ariaLabel')} className="hidden items-center gap-6 md:flex">
      <NavLink href="/recipes">{t('myRecipes')}</NavLink>
      <NavLink href="/household">{t('household')}</NavLink>
    </nav>
  )
}
