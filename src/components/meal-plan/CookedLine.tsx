'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Body } from '@/components/ui/typography'
import { formatDateDisplay } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'

const DAY_MS = 24 * 60 * 60 * 1000

interface CookedLineProps {
  /** The household's last completed entry for the meal, `YYYY-MM-DD`, or null. */
  lastCookedOn: string | null
  /** Its next planned entry from today on, `YYYY-MM-DD`, or null. */
  nextPlannedOn: string | null
  /** `YYYY-MM-DD`. Defaults to the browser's today; tests and stories pin it. */
  today?: string
}

/**
 * When the household last cooked a meal and when it plans it next: "Cooked 12
 * days ago · Planned: Fri 31 Oct". It answers "what have we not had lately?"
 * on the picker's cards (HON-1388).
 */
export function CookedLine({
  lastCookedOn,
  nextPlannedOn,
  today = toDateString(new Date()),
}: CookedLineProps) {
  const t = useTranslations('meal-plan.alternative')
  const locale = useLocale() as Locale

  let cooked = t('notCookedYet')
  if (lastCookedOn) {
    // A browser behind the household's timezone can read the household's today as tomorrow.
    const days = Math.max(
      0,
      Math.round(
        (parseLocalDate(today).getTime() - parseLocalDate(lastCookedOn).getTime()) / DAY_MS,
      ),
    )
    // Days for two weeks, weeks below 9 weeks, months after.
    cooked =
      days === 0
        ? t('cookedToday')
        : days === 1
          ? t('cookedYesterday')
          : days < 14
            ? t('cookedDaysAgo', { count: days })
            : days < 63
              ? t('cookedWeeksAgo', { count: Math.floor(days / 7) })
              : t('cookedMonthsAgo', { count: Math.floor(days / 30) })
  }

  return (
    <Body variant="small" tone="muted">
      {cooked}
      {nextPlannedOn &&
        ` · ${t('plannedOn', { date: formatDateDisplay(parseLocalDate(nextPlannedOn), locale) })}`}
    </Body>
  )
}
