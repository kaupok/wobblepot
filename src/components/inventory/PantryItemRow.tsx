'use client'

import { Star, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

import { PantryAmountButton, PantryAmountField } from './PantryAmountControl'

interface PantryItemRowProps {
  item: PantryItemData
  onToggleStaple: (id: string, currentIsStaple: boolean) => void
  onRemove: (item: PantryItemData) => void
  /** Marks a row at 0 as at home again: the switch going on. */
  onHaveIt?: (item: PantryItemData) => void
  /** Marks a row as ran out: the switch going off. */
  onRanOut?: (item: PantryItemData) => void
  /**
   * Sets the row's amount, `null` for "have some". Shown on an On hand row
   * only: completing a meal never takes a staple off, so an amount on a
   * staple would never change.
   */
  onSetAmount?: (item: PantryItemData, quantity: number | null) => void
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
  isToggling = false,
}: PantryItemRowProps) {
  const tPantry = useTranslations('pantry')
  const isRanOut = item.quantity === 0
  const hasAmount = onSetAmount && !item.isStaple && !isRanOut

  const handleToggle = () => onToggleStaple(item.id, item.isStaple)

  // The field replaces the amount button, so closing it would drop focus to
  // `<body>`: it goes back to the button. A 0 moves the row to Ran out, where
  // `PantrySection` focuses its switch.
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
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
          <div className="flex flex-col">
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
            {/* Under the name, not beside the switch: at 390px a third action
                squeezed the name and its caption to a word per line. `-ml-3`
                lines the label up with the name past the button's padding. */}
            {hasAmount && !isEditingAmount && (
              <div className="-ml-3">
                <PantryAmountButton
                  ref={amountButtonRef}
                  item={item}
                  onClick={() => setIsEditingAmount(true)}
                />
              </div>
            )}
          </div>
        </div>
        {/* `gap-1` and the 51px word (English "Ran out" at the phone's 14px
            caption) keep word, switch and Remove within the 124px the old
            "Ran out" button and Remove took, so at 390px the name loses no
            width (HON-1535). */}
        <div className="flex items-center gap-1">
          {onHaveIt && onRanOut && (
            <>
              {/* The word names the state, not the action, so the row never
                  reads as ran out while it is on hand (HON-1535). A minimum
                  width, so a flip does not move the switch, and a longer word
                  pushes the switch left instead of covering it; `aria-checked` carries
                  the state to a screen reader. */}
              <div aria-hidden data-state-word className="min-w-12.75 text-right">
                <Body variant="caption">{tPantry(isRanOut ? 'ranOut' : 'haveIt')}</Body>
              </div>
              <Switch
                checked={!isRanOut}
                onCheckedChange={(checked) => (checked ? onHaveIt(item) : onRanOut(item))}
                data-on-hand={item.id}
                aria-label={tPantry('ariaHaveIt', { name: item.ingredient.name })}
              />
            </>
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
      </div>
      {hasAmount && isEditingAmount && (
        <PantryAmountField item={item} onSave={handleSaveAmount} onCancel={closeAmountField} />
      )}
    </div>
  )
}
