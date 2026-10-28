'use client'

import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { formatQuantity } from '@/lib/i18n/format-number'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'
import { parseLocalizedNumber } from '@/lib/i18n/parse-number'
import type { PantryItemData } from '@/components/pantry/PantryItem'

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

interface PantryAmountButtonProps {
  item: PantryItemData
  onClick: () => void
}

/**
 * An On hand row's amount: "Add amount" at `null` ("have some"), or the amount
 * it holds. A tap opens `PantryAmountField` under the row.
 */
export const PantryAmountButton = forwardRef<HTMLButtonElement, PantryAmountButtonProps>(
  function PantryAmountButton({ item, onClick }, ref) {
    const tPantry = useTranslations('pantry')
    const locale = useLocale() as Locale
    const unitLabel = useUnitLabel(item.ingredient)
    const name = item.ingredient.name

    if (item.quantity === null || item.quantity <= 0) {
      return (
        <Button
          ref={ref}
          variant="quiet"
          size="sm-touch"
          onClick={onClick}
          data-amount={item.id}
          aria-label={tPantry('ariaAddAmount', { name })}
        >
          {tPantry('addAmount')}
        </Button>
      )
    }

    // Not grouped, so it reads as the field takes it: "1,800" would type back
    // as 1.8. The no-break space keeps the unit on the number's line.
    const amount = `${formatQuantity(item.quantity, locale, { useGrouping: false })} ${unitLabel}`
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="sm-touch"
        onClick={onClick}
        data-amount={item.id}
        aria-label={tPantry('ariaAmount', { name, amount })}
      >
        {amount}
      </Button>
    )
  },
)

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
