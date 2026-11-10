'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'

import { FieldError } from '@/components/FieldError'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { formatQuantity } from '@/lib/i18n/format-number'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'
import { parseLocalizedNumber } from '@/lib/i18n/parse-number'

/**
 * The amount is in the unit the pantry shows for the ingredient: `g`, `ml`
 * (stored 1 ml = 1 g) or `piece`, so it goes to the route as typed (HON-1402).
 * A `pieceDisplay` ingredient, such as onion, stays in grams here.
 */
function useUnitLabel(ingredient: PantryItemData['ingredient']) {
  const pieceLabel = useEnumLabel('Unit', 'piece')
  const unit = ingredient.displayUnit ?? displayUnit(ingredient)
  return unit === 'piece' ? pieceLabel : unit
}

/**
 * An On hand row's amount as the meta line shows it, such as "5 pc", or `null`
 * at "have some" (`null`) and at 0. A tap on ⋯ → Add amount opens
 * `PantryAmountField` under the row.
 */
export function usePantryAmountLabel(item: PantryItemData): string | null {
  const locale = useLocale() as Locale
  const unitLabel = useUnitLabel(item.ingredient)
  if (item.quantity === null || item.quantity <= 0) return null
  // Not grouped, so it reads as the field takes it: "1,800" would type back
  // as 1.8. The no-break space keeps the unit on the number's line.
  return `${formatQuantity(item.quantity, locale, { useGrouping: false })}\u00a0${unitLabel}`
}

interface PantryAmountFieldProps {
  item: PantryItemData
  /** `null` is "have some", 0 is "ran out", above 0 an amount. */
  onSave: (quantity: number | null) => void
  onCancel: () => void
}

/**
 * The field "Add amount" opens. Empty saves `null`, because a household that
 * does not know how much it has still has some. A negative number or text that
 * is not a number shows an error and saves nothing.
 */
export function PantryAmountField({ item, onSave, onCancel }: PantryAmountFieldProps) {
  const tPantry = useTranslations('pantry')
  const tCommon = useTranslations('common')
  const locale = useLocale() as Locale
  const unitLabel = useUnitLabel(item.ingredient)
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(() =>
    item.quantity === null
      ? ''
      : formatQuantity(item.quantity, locale, { useGrouping: false, maximumFractionDigits: 3 }),
  )
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (draft.trim() === '') {
      onSave(null)
      return
    }
    // The parser takes "1,8" and "1.8", and a sign, so a negative is refused here.
    const quantity = parseLocalizedNumber(draft)
    if (quantity === null || quantity < 0) {
      setInvalid(true)
      inputRef.current?.focus()
      return
    }
    onSave(quantity)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2">
      <Label htmlFor={id}>{tPantry('amountLabel')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setInvalid(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onCancel()
              }
            }}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
            className="w-28"
          />
          <Body>{unitLabel}</Body>
        </div>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit">{tCommon('save')}</Button>
      </div>
      <Body variant="caption" id={hintId}>
        {tPantry('amountHint')}
      </Body>
      {invalid && <FieldError id={errorId}>{tPantry('amountInvalid')}</FieldError>}
    </form>
  )
}
