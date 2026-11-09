'use client'

import { useLocale, useTranslations } from 'next-intl'

import { weekdayKey } from '@/lib/i18n/format-dates'
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
 * The servings a recipe entry is cooked for, and is charged for: the own
 * servings plus the leftover lunches, worked out here
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
 * The cook view's words for one leftover lunch's share of the cook:
 * "+ 2.5 for Tuesday" (HON-1600). Each share follows the servings badge, so
 * the badge keeps the entry's own servings and the shares name the rest. The message selects on the weekday, so Estonian
 * declines the day's name ("+ 2 reedeks").
 */
export function useLeftoverShareText() {
  const t = useTranslations('meal-plan.card')
  const locale = useLocale() as Locale

  return (leftover: SharedLeftover): string =>
    t('leftoverShare', {
      servings: formatQuantity(leftover.servings, locale),
      weekday: weekdayKey(parseLocalDate(leftover.date)),
    })
}
