'use client'

import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { type DisplayUnit, displayUnit } from '@/lib/i18n/format-shopping-quantity'

interface ExtraAmountInputProps {
  /** The ingredient, or its display unit when the extra is saved already. */
  ingredient: { defaultUnit: string; measuredByVolume?: boolean } | { unit: DisplayUnit }
  value: number | null
  onValueChange: (value: number | null) => void
  autoFocus?: boolean
}

/**
 * An extra's optional amount (HON-1309), in the ingredient's own unit: grams,
 * millilitres or pieces. There is no unit picker. Millilitres are stored as
 * grams, 1 g = 1 ml (HON-1054), so the number goes to the route as typed.
 */
export function ExtraAmountInput({
  ingredient,
  value,
  onValueChange,
  autoFocus,
}: ExtraAmountInputProps) {
  const t = useTranslations('meal-plan.extras')
  const pieceLabel = useEnumLabel('Unit', 'piece')
  const id = useId()
  const unit = 'unit' in ingredient ? ingredient.unit : displayUnit(ingredient)

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('amount')}</Label>
      <div className="focus-within:border-ring focus-within:ring-ring/50 border-input flex w-fit items-center rounded-md border focus-within:ring-3">
        <NumberInput
          id={id}
          value={value}
          onValueChange={onValueChange}
          integer={unit === 'piece'}
          embedded
          className="w-24"
          autoFocus={autoFocus}
        />
        <span className="text-foreground bg-muted border-l px-2 py-1.5 text-sm">
          {unit === 'piece' ? pieceLabel : unit}
        </span>
      </div>
    </div>
  )
}
