'use client'

import { Plus } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/typography'
import { ShowcaseMealCard } from '@/components/landing/LandingShowcase'
import { CategoryGroup } from '@/components/shopping/CategoryGroup'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { formatDayLong, formatDayShort } from '@/lib/i18n/format-dates'
import { formatInteger } from '@/lib/i18n/format-number'
import { formatWeight } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'
import type { IngredientCategory, MealType } from '@/generated/prisma/enums'

// Pictures of the app, not controls: the caller puts each inside an `inert`
// panel, which takes their buttons and checkboxes out of reach.
const noop = () => {}

/**
 * Thursday and Friday of the example week (`LandingWeek`'s `WEEK_START`):
 * Thursday is the showcase dinner's day (`landing.showcase.day`).
 */
const THURSDAY = new Date(Date.UTC(2026, 0, 8))
const FRIDAY = new Date(Date.UTC(2026, 0, 9))

/**
 * Step 2, "Get a week of meals": one planner day as Today draws it after the
 * first plan. Dinner is planned, and breakfast and lunch wait as the empty
 * slot's "+ Breakfast" and "+ Lunch" buttons on the day's heading line
 * (`TimelineEmptySlot`, HON-1111), which is what the step's text says.
 */
export function PlanDayVignette() {
  const locale = useLocale() as Locale

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Heading variant="section" as="p">
          {formatDayLong(THURSDAY, locale, { timeZone: 'UTC' })}
        </Heading>
        <EmptySlotButton mealType="breakfast" />
        <EmptySlotButton mealType="lunch" />
      </div>
      <ShowcaseMealCard meal="dinner" />
    </div>
  )
}

/** The empty slot's ghost button, without its picker. */
function EmptySlotButton({ mealType }: { mealType: MealType }) {
  const label = useEnumLabel('MealType', mealType)
  return (
    <Button variant="ghost" size="sm">
      <Plus aria-hidden="true" />
      {label}
    </Button>
  )
}

/**
 * Step 3, "Shop once, then cook": the shopping list by aisle, as the shopping page draws it: tonight's salmon
 * and lemon to buy, the asparagus already ticked. Names come from the pantry
 * vignette's catalog keys, so they read in the visitor's language.
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
