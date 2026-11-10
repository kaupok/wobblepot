'use client'

import { Star, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

import { PantryAmountButton, PantryAmountField } from './PantryAmountControl'
import { type PantryStock, PantryStockControl } from './PantryStockControl'

interface PantryItemRowProps {
  item: PantryItemData
  onToggleStaple: (id: string, currentIsStaple: boolean) => void
  onRemove: (item: PantryItemData) => void
  /** Marks a row at 0 as at home again: Have it from Ran out. */
  onHaveIt?: (item: PantryItemData) => void
  /** Marks a row as ran out: the Ran out part. */
  onRanOut?: (item: PantryItemData) => void
  /**
   * Sets the row's amount, `null` for "have some". Shown on an On hand row
   * only: completing a meal never takes a staple off, so an amount on a
   * staple would never change.
   */
  onSetAmount?: (item: PantryItemData, quantity: number | null) => void
  /**
   * Marks the row running low, or clears it (HON-1587): the Low part, and
   * Have it from Low. Low on a row at 0 also sets it to have some, in the
   * same request.
   */
  onSetLow?: (item: PantryItemData, low: boolean) => void
  isToggling?: boolean
}

/**
 * The pantry row `/shopping` actually renders, one per item in each
 * `PantrySection` group. Its own file so `PantryItemRowSkeleton` can be
 * measured against it — the placeholder is a
 * copy of this box, and a copy nothing points at is how HON-628 happened.
 * (`components/pantry/PantryItem.tsx` is a near-duplicate with no callsite of
 * its own; only its `PantryItemData` type is used.)
 */
export function PantryItemRow({
  item,
  onToggleStaple,
  onRemove,
  onHaveIt,
  onRanOut,
  onSetAmount,
  onSetLow,
  isToggling = false,
}: PantryItemRowProps) {
  const tPantry = useTranslations('pantry')
  const isRanOut = item.quantity === 0
  const hasAmount = onSetAmount && !item.isStaple && !isRanOut
  const hasStock = onHaveIt && onRanOut && onSetLow
  const stock: PantryStock = isRanOut ? 'ranOut' : item.low ? 'low' : 'haveIt'

  const handleStockChange = (next: PantryStock) => {
    if (next === 'ranOut') onRanOut?.(item)
    else if (isRanOut && next === 'haveIt') onHaveIt?.(item)
    else onSetLow?.(item, next === 'low')
  }

  const handleToggle = () => onToggleStaple(item.id, item.isStaple)

  // The field replaces the amount button, so closing it would drop focus to
  // `<body>`: it goes back to the button. A 0 moves the row to Ran out, where
  // `PantrySection` focuses its stock control.
  const [isEditingAmount, setIsEditingAmount] = useState(false)
  const amountButtonRef = useRef<HTMLButtonElement>(null)
  const focusAmountButton = useRef(false)
  useEffect(() => {
    if (isEditingAmount || !focusAmountButton.current) return
    focusAmountButton.current = false
    amountButtonRef.current?.focus()
  }, [isEditingAmount])

  const closeAmountField = () => {
    focusAmountButton.current = true
    setIsEditingAmount(false)
  }

  const handleSaveAmount = (quantity: number | null) => {
    closeAmountField()
    if (quantity !== item.quantity) onSetAmount?.(item, quantity)
  }

  return (
    // No entrance when a ticked shopping item lands here: it happens many
    // times a session, and the row appearing is the change (docs/DESIGN.md →
    // Reject list).
    <div className="flex flex-col gap-3 p-3">
      {/* The stock control wraps to its own line and runs under the name and
          the right side both: at 390px it does not fit beside the amount
          button. The left shows the state, the right how much (HON-1624). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleToggle}
          disabled={isToggling}
          data-staple={item.id}
          aria-label={item.isStaple ? tPantry('ariaUnstaple') : tPantry('ariaToggleStaple')}
        >
          <Star
            className={cn(
              'size-4',
              item.isStaple
                ? 'fill-warning text-warning'
                : 'text-muted-foreground hover:text-warning',
            )}
          />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <Body>{item.ingredient.name}</Body>
          {item.neededQuantity !== undefined &&
            item.neededQuantity > 0 &&
            item.neededDisplayQuantity &&
            item.windowDays !== undefined && (
              <Body variant="caption">
                {/* A vague quantity's display is the phrase itself, so it would
                    read "to taste needed in…" — drop it instead (HON-783). */}
                {item.isVague
                  ? tPantry('neededInWindowVague', { days: item.windowDays })
                  : tPantry('neededInWindow', {
                      quantity: item.neededDisplayQuantity,
                      days: item.windowDays,
                    })}
              </Body>
            )}
        </div>
        <div className="flex items-center gap-1">
          {hasAmount && !isEditingAmount && (
            <PantryAmountButton
              ref={amountButtonRef}
              item={item}
              onClick={() => setIsEditingAmount(true)}
            />
          )}
          <Button
            variant="quiet-destructive"
            size="icon-sm"
            onClick={() => onRemove(item)}
            data-remove={item.id}
            aria-label={tPantry('ariaRemove', { name: item.ingredient.name })}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        {hasStock && (
          // Under the name and caption, lined up with the name past the star
          // (32px and the 12px gap). `gap-y-2` keeps each part's 44px target
          // clear of the buttons above.
          <div className="basis-full pl-11">
            <PantryStockControl
              pantryItemId={item.id}
              name={item.ingredient.name}
              stock={stock}
              onStockChange={handleStockChange}
            />
          </div>
        )}
      </div>
      {hasAmount && isEditingAmount && (
        <PantryAmountField item={item} onSave={handleSaveAmount} onCancel={closeAmountField} />
      )}
    </div>
  )
}
