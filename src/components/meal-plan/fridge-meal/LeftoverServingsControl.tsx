'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'

/** A leftover item's servings range, as `leftoverServingsSchema` takes it (HON-1394). */
export const LEFTOVER_SERVINGS_MIN = 0.5
export const LEFTOVER_SERVINGS_MAX = 20
const STEP = 0.5

interface LeftoverServingsControlProps {
  /** Null for a cooked source whose servings are not set: they change nothing. */
  value: number | null
  onChange: (servings: number) => void
  /** Where + starts from an unset value: the household's own servings. */
  defaultServings: number
  /** The group's accessible name, which names the item. */
  label: string
}

/**
 * The servings a leftover item takes from its source (HON-1396): − and + in
 * half steps, 0.5 to 20, for a child's portion. Buttons only, no typing, so
 * the value is always one the server takes and shows as `formatQuantity` has
 * it ("2,5" in Estonian).
 */
export function LeftoverServingsControl({
  value,
  onChange,
  defaultServings,
  label,
}: LeftoverServingsControlProps) {
  const t = useTranslations('meal-plan.fridge')
  const locale = useLocale() as Locale
  const canLower = value !== null && value > LEFTOVER_SERVINGS_MIN
  const canRaise = value === null || value < LEFTOVER_SERVINGS_MAX

  function step(by: number) {
    const next = value === null ? defaultServings : value + by
    onChange(Math.min(LEFTOVER_SERVINGS_MAX, Math.max(LEFTOVER_SERVINGS_MIN, next)))
  }

  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {/* Not `disabled`: a disabled button drops focus at the bound (HON-803). */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('fewerServings')}
        aria-disabled={!canLower || undefined}
        onClick={() => canLower && step(-STEP)}
      >
        <Minus aria-hidden="true" />
      </Button>
      <Body variant="small" aria-live="polite">
        {value === null
          ? t('servingsNotSet')
          : t('servingsValue', { count: value, servings: formatQuantity(value, locale) })}
      </Body>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('moreServings')}
        aria-disabled={!canRaise || undefined}
        onClick={() => canRaise && step(STEP)}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  )
}
