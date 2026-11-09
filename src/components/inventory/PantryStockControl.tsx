'use client'

import { useTranslations } from 'next-intl'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type PantryStock = 'haveIt' | 'low' | 'ranOut'

interface PantryStockControlProps {
  /** The pantry row the control acts on. */
  pantryItemId: string
  /** The name the group's label reads. */
  name: string
  stock: PantryStock
  onStockChange: (stock: PantryStock) => void
}

/**
 * The pantry row's stock state, Have it · Low · Ran out, as one control
 * (HON-1624). It replaced the Have it / Ran out switch and the Running low
 * toggle, which read as two settings for one state. The pressed part is filled
 * and carries a check, so the state does not rest on the fill alone.
 */
export function PantryStockControl({
  pantryItemId,
  name,
  stock,
  onStockChange,
}: PantryStockControlProps) {
  const tPantry = useTranslations('pantry')
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      tone="primary"
      size="sm-touch"
      indicator
      value={stock}
      // A press on the pressed part would empty a single group: the state
      // always has a value, so that press changes nothing.
      onValueChange={(next) => {
        if (next) onStockChange(next as PantryStock)
      }}
      data-stock={pantryItemId}
      aria-label={tPantry('ariaStock', { name })}
    >
      <ToggleGroupItem value="haveIt">{tPantry('haveIt')}</ToggleGroupItem>
      <ToggleGroupItem value="low">{tPantry('low')}</ToggleGroupItem>
      <ToggleGroupItem value="ranOut">{tPantry('ranOut')}</ToggleGroupItem>
    </ToggleGroup>
  )
}
