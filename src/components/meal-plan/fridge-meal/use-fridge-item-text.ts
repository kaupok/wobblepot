'use client'

import { useLocale, useTranslations } from 'next-intl'

import { formatDayLong, weekdayKey } from '@/lib/i18n/format-dates'
import { formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import type { FridgeItemInput } from '@/lib/meal-plans/fridge-items'

import type { FridgeMealItem } from '../types'

/** What the client knows of an item: the stored row, or one added in the picker. */
export type FridgeItemShown = Omit<FridgeMealItem, 'id'>

/**
 * The words one fridge-meal item shows by, on the card, in the picker and in
 * the completion dialog (HON-1277): the ingredient's name, the leftovers'
 * meal and weekday ("Mash, from Tuesday"), or the household's own text.
 *
 * A leftover the assistant planned also names its source's slot and its
 * servings, and "planned" while the source is not cooked yet (HON-1395):
 * "Mash, from Tuesday at dinner · 2.5 servings · planned".
 */
export function useFridgeItemText() {
  const t = useTranslations('meal-plan.fridge')
  const locale = useLocale() as Locale

  return (item: FridgeItemShown): string => {
    if (item.label !== null) return item.label
    if (item.sourceEntryId !== null) {
      const day = item.sourceDate ? formatDayLong(parseLocalDate(item.sourceDate), locale) : ''
      if (!item.name) return t('leftoverNoName', { day })
      if (item.servings === null || !item.sourceMealType)
        return t('leftover', { meal: item.name, day })
      const text = t('leftoverDetail', {
        meal: item.name,
        day,
        mealType: item.sourceMealType,
        count: item.servings,
        servings: formatQuantity(item.servings, locale),
      })
      return item.sourceState === 'planned' ? `${text} · ${t('sourcePlanned')}` : text
    }
    return item.name ?? ''
  }
}

/**
 * The card's line under a leftover's name, for a leftover the assistant
 * planned (HON-1395): the day its source is cooked, "Leftovers from Tuesday".
 * The message selects on the weekday, so Estonian declines the day's name
 * ("Jäägid teisipäevast"). Null for a leftover picked in the dialog, which
 * takes no servings.
 */
export function useLeftoverSourceText() {
  const t = useTranslations('meal-plan.fridge')

  return (item: FridgeItemShown): string | null => {
    if (item.servings === null || !item.sourceMealType || !item.sourceDate) return null
    return t('leftoverSource', { weekday: weekdayKey(parseLocalDate(item.sourceDate)) })
  }
}

/**
 * The body the entry routes take for an item. A leftover item keeps its
 * `servings`, so Edit items and Undo do not drop what the assistant set
 * (HON-1394).
 */
export function toFridgeItemInput(item: FridgeItemShown): FridgeItemInput {
  if (item.ingredientId !== null) return { ingredientId: item.ingredientId }
  if (item.sourceEntryId !== null) {
    return item.servings === null
      ? { sourceEntryId: item.sourceEntryId }
      : { sourceEntryId: item.sourceEntryId, servings: item.servings }
  }
  return { label: item.label ?? '' }
}
