'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { track } from '@/lib/analytics'
import { formatDateRange } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import {
  type ClipboardSection,
  formatShoppingListForClipboard,
} from '@/lib/shopping/format-clipboard'

/**
 * The shopping list's Copy list action: writes the still-to-buy sections to the
 * clipboard under a dated heading, and holds the ~2s checkmark that confirms it.
 * `buildSections` mirrors the grouping the list is showing, so it stays with
 * `ShoppingSection`, which owns that state.
 */
export function useCopyShoppingList(
  buildSections: () => ClipboardSection[],
  startDate: string,
  endDate: string,
) {
  const locale = useLocale() as Locale
  const tShopping = useTranslations('shopping')
  const tErrors = useTranslations('shopping.errors')
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const copyInFlightRef = useRef(false)

  // Don't leave the "copied" checkmark timer running after unmount.
  useEffect(() => () => clearTimeout(copiedTimeoutRef.current), [])

  const handleCopy = async () => {
    // The button stays enabled through the ~2s checkmark, so a double-tap would
    // otherwise double-count `shopping:list_copied`.
    // Same shape as `ShoppingSection`'s `handleToggle` pending guard.
    if (copyInFlightRef.current) return

    copyInFlightRef.current = true
    try {
      // Built synchronously, before any `await`: Safari drops the user-gesture
      // association if the clipboard write isn't the first thing the handler
      // does. It sits inside the `try` because `parseLocalDate` throws on a
      // malformed date and `Intl.formatRange` throws on the resulting invalid
      // `Date` — and `startDate` / `endDate` arrive unvalidated, since
      // `src/app/shopping/page.tsx` casts the API response rather than parsing
      // it. Outside the `try` those throws became an unhandled rejection and a
      // button that looked dead, with no toast at all.
      const sections = buildSections()
      const itemCount = sections.reduce((sum, section) => sum + section.lines.length, 0)
      const heading = tShopping('copyHeading', {
        range: formatDateRange(parseLocalDate(startDate), parseLocalDate(endDate), locale, {
          withYear: true,
        }),
      })
      const text = formatShoppingListForClipboard(heading, sections)

      if (!text) return

      // `navigator.clipboard` is undefined outside a secure context. Optional
      // chaining would resolve to `undefined` and show the checkmark for a copy
      // that never happened, so check explicitly.
      if (!navigator.clipboard?.writeText) {
        toast.error(tErrors('copyFailed'))
        return
      }

      await navigator.clipboard.writeText(text)
      // The checkmark is the confirmation, not a toast: it is where the user is
      // already looking (HON-955). The status region beside the button voices it.
      setCopied(true)
      void track('shopping:list_copied', { source: 'shopping_list', item_count: itemCount })
      clearTimeout(copiedTimeoutRef.current)
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(tErrors('copyFailed'))
    } finally {
      copyInFlightRef.current = false
    }
  }

  return { copied, handleCopy }
}
