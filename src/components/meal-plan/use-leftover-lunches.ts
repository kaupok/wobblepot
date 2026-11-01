'use client'

import { useLocale, useTranslations } from 'next-intl'

import { formatDayLong, weekdayKey } from '@/lib/i18n/format-dates'
import { formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { parseLocalDate } from '@/lib/meal-planning/dates'

import type { LeftoverLunch } from './types'

/** A leftover lunch that takes a share of the cook. */
export type SharedLeftover = LeftoverLunch & { servings: number }

/**
 * The leftover lunches that add to a recipe entry's cook (HON-1394). An item
 * added in the picker carries no servings, so it adds nothing and shows nothing.
 */
export function sharedLeftovers(leftoversFor: readonly LeftoverLunch[] = []): SharedLeftover[] {
  return leftoversFor.filter((leftover): leftover is SharedLeftover => leftover.servings !== null)
}

/**
 * The servings a recipe entry is cooked for, as the card and the cook view
 * show them: the own servings plus the leftover lunches, worked out here
 * rather than read from `cookServings`, so the total follows the servings
 * control before the server sends a new one. Pass `cookedServings` for a
 * completed entry: it shows the count it was cooked at.
 */
export function getShownCookServings(
  ownServings: number,
  leftovers: readonly SharedLeftover[],
  cookedServings?: number,
): number {
  if (cookedServings !== undefined) return cookedServings
  return leftovers.reduce((total, leftover) => total + leftover.servings, ownServings)
}

/**
 * The words for a recipe entry's leftover lunches, one part per day and
 * joined with " · ": "leftovers for Tuesday" (HON-1395). The servings total
 * before it already counts them. The message selects on the weekday, so
 * Estonian declines the day's name ("jäägid teisipäevaks").
 */
export function useLeftoverLunchText() {
  const t = useTranslations('meal-plan.card')

  return (leftovers: readonly SharedLeftover[]): string => {
    const parts = leftovers.map((leftover) =>
      t('leftoverFor', { weekday: weekdayKey(parseLocalDate(leftover.date)) }),
    )
    return [...new Set(parts)].join(' · ')
  }
}

/**
 * The cook view's words for the leftover lunches, with each one's servings
 * and slot: "2.5 for lunch: Tuesday" (HON-1395). The cook sees only the
 * dinner, so the line says how much to set aside, which the card leaves to
 * the lunch card beside it (HON-1574). Separators, not prepositions, so
 * Estonian needs no declension (docs/LOCALIZATION.md).
 */
export function useLeftoverLunchDetailText() {
  const t = useTranslations('meal-plan.card')
  const locale = useLocale() as Locale

  return (leftovers: readonly SharedLeftover[]): string =>
    leftovers
      .map((leftover) =>
        t('leftoverForDetail', {
          servings: formatQuantity(leftover.servings, locale),
          mealType: leftover.mealType,
          day: formatDayLong(parseLocalDate(leftover.date), locale),
        }),
      )
      .join(' · ')
}
