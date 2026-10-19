'use client'

import { useTranslations } from 'next-intl'
import { RouteTabs } from '@/components/RouteTabs'
import { HOUSEHOLD_TABS } from './tabs'

/**
 * The `/household` tab list (HON-1257): Members, Meal preferences and
 * Settings. The bar is the shared `RouteTabs`, which scrolls sideways when the
 * three do not fit.
 */
export function HouseholdTabs() {
  const t = useTranslations('household')

  return (
    <RouteTabs
      label={t('tabsLabel')}
      tabs={HOUSEHOLD_TABS.map(({ key, href }) => ({ key, href, label: t(`tabs.${key}`) }))}
    />
  )
}
