'use client'

import { useLocale, useTranslations } from 'next-intl'

import { Body } from '@/components/ui/typography'
import { formatInteger } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'

import { SideDishMenu, type SideDishMenuContext } from './SideDishMenu'
import type { PlanEntrySide } from './types'

/**
 * One line per side dish under a main card's name (HON-1610): "+ Cucumber
 * salad · 3", the side's name and its own servings. The `+ {items}` form is the
 * fridge card's, so the copy joins with separators, not prepositions
 * (docs/LOCALIZATION.md). With `menu`, each line opens the side's menu
 * (HON-1611); without it, as on a read-only card, the lines are text.
 */
export function SideDishLines({
  sides,
  menu,
}: {
  sides: readonly PlanEntrySide[]
  menu?: SideDishMenuContext
}) {
  const t = useTranslations('meal-plan.fridge')
  const locale = useLocale() as Locale
  const named = sides.filter((side) => side.mealName)
  if (named.length === 0) return null
  return (
    <div className="flex flex-col items-start">
      {named.map((side) =>
        menu ? (
          <SideDishMenu key={side.entryId} side={side} {...menu} />
        ) : (
          <Body key={side.entryId} variant="paragraph" tone="muted">
            {t('withItems', {
              items: `${side.mealName} · ${formatInteger(side.servings, locale)}`,
            })}
          </Body>
        ),
      )}
    </div>
  )
}
