'use client'

import { useLocale, useTranslations } from 'next-intl'

import { Body } from '@/components/ui/typography'
import { formatInteger } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'

import type { PlanEntrySide } from './types'

/**
 * One line per side dish under a main card's name (HON-1610): "+ Cucumber
 * salad · 3", the side's name and its own servings. The `+ {items}` form is the
 * fridge card's, so the copy joins with separators, not prepositions
 * (docs/LOCALIZATION.md).
 */
export function SideDishLines({ sides }: { sides: readonly PlanEntrySide[] }) {
  const t = useTranslations('meal-plan.fridge')
  const locale = useLocale() as Locale
  const named = sides.filter((side) => side.mealName)
  if (named.length === 0) return null
  return (
    <div>
      {named.map((side) => (
        <Body key={side.entryId} variant="paragraph" tone="muted">
          {t('withItems', { items: `${side.mealName} · ${formatInteger(side.servings, locale)}` })}
        </Body>
      ))}
    </div>
  )
}
