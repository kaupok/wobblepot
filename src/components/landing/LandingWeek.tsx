'use client'

import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Body } from '@/components/ui/typography'
import { formatDayShort } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import { cn } from '@/lib/utils'

/**
 * The example week, Monday first: each day's dinner (`landing.week.meals`) and
 * its minutes. Tonight's day shows the deck's dinner instead, so the strip and
 * the front card name the same meal.
 */
const WEEK = [
  { key: 'mon', minutes: 35 },
  { key: 'tue', minutes: 45 },
  { key: 'wed', minutes: 40 },
  { key: 'thu', minutes: 30 },
  { key: 'fri', minutes: 50 },
  { key: 'sat', minutes: 90 },
  { key: 'sun', minutes: 80 },
] as const

/** A Monday, so day `i` of the week is `WEEK_START` plus `i` days. */
const WEEK_START = Date.UTC(2026, 0, 5)
const DAY_MS = 24 * 60 * 60 * 1000

interface LandingWeekProps {
  locale: Locale
  /** Tonight's day, 0 for Monday to 6 for Sunday. Earlier days are cooked. */
  tonightIndex: number
  /** The deck's dinner, so the strip names the meal the front card shows. */
  tonight: { name: string; minutes: number | null }
}

/**
 * Monday to Sunday under the hero's deck: the days before tonight cooked and
 * muted with a check, tonight in the foreground's ink, the rest to come. So
 * the hero shows "dinner for the whole week", not one day.
 *
 * A row of seven from `md`. On a phone, a strip that scrolls sideways and runs
 * to the screen's edges (the caller's gutter is pulled back with `-mx-4`), so
 * the next day peeks in. It opens scrolled to tonight, centred, because
 * Thursday would otherwise start off the screen. The strip is a focusable
 * region, so a keyboard can scroll it.
 */
export function LandingWeek({ locale, tonightIndex, tonight }: LandingWeekProps) {
  const t = useTranslations('landing.week')
  const stripRef = useRef<HTMLDivElement>(null)
  const tonightRef = useRef<HTMLLIElement>(null)

  // A no-op from `md`, where the strip does not scroll. Set once on mount, so
  // it never fights the visitor's own scrolling.
  useEffect(() => {
    const strip = stripRef.current
    const cell = tonightRef.current
    if (!strip || !cell || strip.scrollWidth <= strip.clientWidth) return
    const offset = cell.getBoundingClientRect().left - strip.getBoundingClientRect().left
    strip.scrollLeft += offset - (strip.clientWidth - cell.offsetWidth) / 2
  }, [])

  return (
    <div className="flex w-full max-w-6xl flex-col gap-3">
      <div className="text-center">
        <Body variant="muted">{t('label')}</Body>
      </div>
      <div
        ref={stripRef}
        role="region"
        aria-label={t('label')}
        tabIndex={0}
        className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:overflow-visible md:px-0 md:pb-0"
      >
        <ol role="list" className="flex list-none gap-2 text-left md:grid md:grid-cols-7">
          {WEEK.map((day, index) => {
            const dayName = formatDayShort(new Date(WEEK_START + index * DAY_MS), locale, {
              timeZone: 'UTC',
            })
            const isTonight = index === tonightIndex
            const cooked = index < tonightIndex
            const minutes = isTonight ? tonight.minutes : day.minutes
            return (
              <li
                key={day.key}
                ref={isTonight ? tonightRef : undefined}
                aria-current={isTonight ? 'date' : undefined}
                className={cn(
                  'flex min-h-28 w-36 shrink-0 flex-col gap-1.5 rounded-xl border p-3 md:w-auto',
                  isTonight && 'border-foreground bg-foreground text-background',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Body variant="figure-small" tone={isTonight ? 'default' : 'muted'}>
                    {isTonight ? `${dayName} · ${t('tonight')}` : dayName}
                  </Body>
                  {cooked && (
                    <>
                      <Check aria-hidden="true" className="text-muted-foreground size-4" />
                      <span className="sr-only">{t('cooked')}</span>
                    </>
                  )}
                </div>
                <Body variant="paragraph" tone={cooked ? 'muted' : 'default'}>
                  {isTonight ? tonight.name : t(`meals.${day.key}`)}
                </Body>
                {minutes !== null && (
                  <div className="mt-auto">
                    <Body variant="figure-small" tone={isTonight ? 'default' : 'muted'}>
                      {t('minutes', { count: minutes })}
                    </Body>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
