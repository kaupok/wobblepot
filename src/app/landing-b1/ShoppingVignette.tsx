'use client'

import { useLocale, useTranslations } from 'next-intl'
import { CategoryGroup } from '@/components/shopping/CategoryGroup'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { formatDayShort } from '@/lib/i18n/format-dates'
import { formatInteger } from '@/lib/i18n/format-number'
import { formatWeight } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'
import type { IngredientCategory } from '@/generated/prisma/enums'

const noop = () => {}

/** Thursday and Friday of the example week (`LandingB1`'s `WEEK_START`). */
const THURSDAY = new Date(Date.UTC(2026, 0, 8))
const FRIDAY = new Date(Date.UTC(2026, 0, 9))

/**
 * The shopping list by aisle, as the shopping page draws it: tonight's salmon
 * and lemon to buy, the asparagus already ticked. Names come from the pantry
 * vignette's catalog keys, so they read in the visitor's language. A picture:
 * the caller puts it inside an `inert` panel.
 */
export function ShoppingVignette() {
  const t = useTranslations('landing.why.pantry.vignette')
  const locale = useLocale() as Locale
  const thu = formatDayShort(THURSDAY, locale, { timeZone: 'UTC' })
  const fri = formatDayShort(FRIDAY, locale, { timeZone: 'UTC' })

  const item = (
    key: 'salmon' | 'asparagus' | 'lemon',
    displayQuantity: string,
    neededBy: string,
    purchased = false,
  ): ShoppingItemData => ({
    ingredientId: key,
    name: t(key),
    displayQuantity,
    purchased,
    neededByDate: '',
    neededByRelative: neededBy,
    neededByAbsolute: neededBy,
  })

  const groups: Array<{ category: IngredientCategory; items: ShoppingItemData[] }> = [
    { category: 'protein', items: [item('salmon', formatWeight(300, locale), thu)] },
    { category: 'vegetable', items: [item('asparagus', formatWeight(250, locale), thu, true)] },
    { category: 'fruit', items: [item('lemon', formatInteger(2, locale), fri)] },
  ]

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <CategoryGroup
          key={group.category}
          category={group.category}
          items={group.items}
          onToggleItem={noop}
        />
      ))}
    </div>
  )
}
