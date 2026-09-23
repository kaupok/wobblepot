'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { NumberInput } from '@/components/ui/number-input'
import { cn } from '@/lib/utils'

interface QuantityControlsProps {
  totalQuantity: number
  unitLabel: string
  isVague: boolean
  isInvalidQuantity: boolean
  disabled: boolean
  onQuantityChange: (newQuantity: number) => void
  onSetQuantity: () => void
  onMarkAsVague: () => void
}

export function QuantityControls({
  totalQuantity,
  unitLabel,
  isVague,
  isInvalidQuantity,
  disabled,
  onQuantityChange,
  onSetQuantity,
  onMarkAsVague,
}: QuantityControlsProps) {
  const t = useTranslations('recipes.ingredientRow')
  const tForm = useTranslations('recipes.form.componentList')

  if (isVague) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={onSetQuantity} disabled={disabled}>
        {tForm('setQuantity')}
      </Button>
    )
  }

  return (
    <>
      <div
        className={cn(
          // The group draws the focus ring its `embedded` field gives up.
          'focus-within:border-ring focus-within:ring-ring/50 flex items-center rounded-md border focus-within:ring-3',
          isInvalidQuantity ? 'border-destructive' : 'border-input',
        )}
      >
        <NumberInput
          value={totalQuantity}
          onValueChange={(v) => {
            if (v !== null) onQuantityChange(v)
          }}
          aria-label={t('quantityAria')}
          embedded
          className="w-20"
          disabled={disabled}
        />
        {unitLabel && (
          <span className="text-muted-foreground bg-muted border-l px-2 py-1.5 text-sm">
            {unitLabel}
          </span>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onMarkAsVague} disabled={disabled}>
        {tForm('noQuantity')}
      </Button>
    </>
  )
}
