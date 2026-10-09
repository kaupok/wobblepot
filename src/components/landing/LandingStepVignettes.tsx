'use client'

import type { ReactNode } from 'react'
import { Ban } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Body } from '@/components/ui/typography'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { formatDayShort } from '@/lib/i18n/format-dates'
import { formatInteger } from '@/lib/i18n/format-number'
import { formatWeight } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'
import { cn } from '@/lib/utils'

/*
 * The pictures above the three steps of landing direction B1 (HON-1116).
 * Each is three rows in one shape: a mark, a name, a detail on the right. One
 * idea per picture, so the band reads at a glance. Earlier versions drew the
 * app's own household page, planner day and shopping list, and at this size
 * their labels, badges and dates made the band busy.
 *
 * Pictures, not controls: the caller puts each inside an `inert` panel.
 */

/** A Monday: the first day of `LandingWeek`'s example week. */
const WEEK_START = Date.UTC(2026, 0, 5)
const DAY_MS = 24 * 60 * 60 * 1000
const weekday = (index: number) => new Date(WEEK_START + index * DAY_MS)

/** The avatar tints, one per member, from the status tokens' muted fills. */
const AVATAR_TINTS = ['bg-info-muted', 'bg-success-muted', 'bg-warning-muted'] as const

/**
 * Step 1, "Tell it who's at the table": the showcase household
 * (`landing.why.kids.vignette`), the toddler with a peanut allergy.
 */
export function TableVignette() {
  const t = useTranslations('landing.why.kids.vignette')
  const peanuts = useEnumLabel('Allergen', 'peanuts')
  const members = [t('adult1'), t('adult2'), t('toddler')]

  return (
    <StepRows>
      {members.map((name, index) => (
        <StepRow
          key={name}
          mark={
            <div
              className={cn(
                'flex size-9 items-center justify-center rounded-full',
                AVATAR_TINTS[index],
              )}
            >
              <Body variant="small">{name.charAt(0)}</Body>
            </div>
          }
          name={name}
          detail={
            index === members.length - 1 && (
              <Badge variant="warning">
                <Ban aria-hidden="true" />
                {peanuts}
              </Badge>
            )
          }
        />
      ))}
    </StepRows>
  )
}

/**
 * Step 2, "Get a week of meals": three dinners from Thursday, the showcase
 * day. Thursday's is the showcase dinner, as on the hero's week strip; Friday
 * and Saturday are the strip's, with its minutes.
 */
export function WeekVignette() {
  const t = useTranslations('landing')
  const locale = useLocale() as Locale
  const days = [
    { index: 3, name: t('showcase.dinner.name'), minutes: 25 },
    { index: 4, name: t('week.meals.fri'), minutes: 50 },
    { index: 5, name: t('week.meals.sat'), minutes: 90 },
  ]

  return (
    <StepRows>
      {days.map(({ index, name, minutes }) => (
        <StepRow
          key={index}
          mark={
            <Body variant="figure-small" tone="muted">
              {formatDayShort(weekday(index), locale, { timeZone: 'UTC' })}
            </Body>
          }
          name={name}
          detail={
            <Body variant="figure-small" tone="muted">
              {t('week.minutes', { count: minutes })}
            </Body>
          }
        />
      ))}
    </StepRows>
  )
}

/**
 * Step 3, "Shop once, then cook": tonight's salmon and lemon to buy, the
 * asparagus already in the basket. Names come from the pantry vignette's
 * catalog keys, so they read in the visitor's language.
 */
export function ShoppingVignette() {
  const t = useTranslations('landing.why.pantry.vignette')
  const locale = useLocale() as Locale
  const items = [
    { key: 'salmon', quantity: formatWeight(300, locale), done: false },
    { key: 'asparagus', quantity: formatWeight(250, locale), done: true },
    { key: 'lemon', quantity: formatInteger(2, locale), done: false },
  ] as const

  return (
    <StepRows>
      {items.map(({ key, quantity, done }) => (
        <StepRow
          key={key}
          mark={<Checkbox checked={done} aria-label={t(key)} />}
          name={t(key)}
          done={done}
          detail={
            <Body variant="figure-small" tone="muted">
              {quantity}
            </Body>
          }
        />
      ))}
    </StepRows>
  )
}

function StepRows({ children }: { children: ReactNode }) {
  return <ul className="flex list-none flex-col divide-y">{children}</ul>
}

/** One row: a fixed-width mark, the name, and a detail on the right. */
function StepRow({
  mark,
  name,
  detail,
  done = false,
}: {
  mark: ReactNode
  name: string
  detail?: ReactNode
  /** A ticked shopping item: the name struck through and muted. */
  done?: boolean
}) {
  return (
    <li className="flex min-h-16 items-center gap-3 py-3">
      <div className="flex w-9 shrink-0 justify-center">{mark}</div>
      <div className="min-w-0 flex-1">
        <Body
          variant="paragraph"
          tone={done ? 'muted' : 'default'}
          className={cn(done && 'line-through')}
        >
          {name}
        </Body>
      </div>
      {detail}
    </li>
  )
}
