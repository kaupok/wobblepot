'use client'

import { useTranslations } from 'next-intl'

import { RouteTabs } from '@/components/RouteTabs'

import { ACCOUNT_TABS } from './tabs'

/**
 * The `/account` tab list (HON-1229): Profile, Reminders (HON-1256),
 * Connections and Your data. The bar is the shared `RouteTabs`, which scrolls
 * sideways when the four do not fit, as in Estonian at 360px.
 */
export function AccountTabs() {
  const t = useTranslations('account')

  return (
    <RouteTabs
      label={t('tabsLabel')}
      tabs={ACCOUNT_TABS.map(({ key, href }) => ({ key, href, label: t(`tabs.${key}`) }))}
    />
  )
}
