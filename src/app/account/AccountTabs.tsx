'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { ACCOUNT_TABS } from './tabs'

/**
 * The `/account` tab list (HON-1229): three links, the current one marked by
 * `aria-current`, its colour and a 2px underline, so colour is not the only
 * cue. Each tab clears the 44px touch floor, and the tabs keep their natural
 * width, so the three fit one row at 360px in both locales.
 */
export function AccountTabs() {
  const pathname = usePathname()
  const t = useTranslations('account')

  return (
    <nav aria-label={t('tabsLabel')} className="border-b">
      <ul className="-mb-px flex">
        {ACCOUNT_TABS.map(({ key, href }) => {
          // Exact match: `/account` is a prefix of the other two tabs.
          const isCurrent = pathname === href
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'min-h-touch flex items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150',
                  isCurrent
                    ? 'border-primary text-foreground'
                    : 'text-muted-foreground hover:text-primary border-transparent',
                )}
              >
                {t(`tabs.${key}`)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
