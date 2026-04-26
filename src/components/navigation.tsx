'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface NavigationProps {
  isAuthenticated: boolean
  hasHousehold: boolean
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
      <Link href="/" className="hover:text-primary text-sm font-medium transition-colors">
        {t('today')}
      </Link>
      <Link href="/shopping" className="hover:text-primary text-sm font-medium transition-colors">
        {t('pantryAndShopping')}
      </Link>
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
      <Link href="/recipes" className="hover:text-primary text-sm font-medium transition-colors">
        {t('myRecipes')}
      </Link>
      <Link href="/household" className="hover:text-primary text-sm font-medium transition-colors">
        {t('household')}
      </Link>
    </nav>
  )
}
