'use client'

import { MoreHorizontal, PencilLine, Plus, Star, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

import { PantryAmountField, usePantryAmountLabel } from './PantryAmountControl'
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

  // The field opens under the row and closes back to ⋯, so focus does not
  // fall to `<body>`. A 0 moves the row to Ran out, where `PantrySection`
  // focuses its stock control.
  const [isEditingAmount, setIsEditingAmount] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const focusMoreButton = useRef(false)
  useEffect(() => {
    if (isEditingAmount || !focusMoreButton.current) return
    focusMoreButton.current = false
    moreButtonRef.current?.focus()
  }, [isEditingAmount])

  const closeAmountField = () => {
    focusMoreButton.current = true
    setIsEditingAmount(false)
  }

  const handleSaveAmount = (quantity: number | null) => {
    closeAmountField()
    if (quantity !== item.quantity) onSetAmount?.(item, quantity)
  }

  // Radix returns focus to ⋯ as the menu closes, and on a pointer pick it
  // pulls focus back into the closing menu first (HON-946). So a menu item
  // only names its action, and the action runs once the menu has closed: the
  // field then focuses its input, and Remove's focus move to the next row
  // is the last one.
  const pendingAction = useRef<'amount' | 'remove' | null>(null)
  const handleMenuCloseAutoFocus = (event: Event) => {
    const action = pendingAction.current
    if (!action) return
    event.preventDefault()
    pendingAction.current = null
    if (action === 'amount') setIsEditingAmount(true)
    else onRemove(item)
  }

  const amountLabel = usePantryAmountLabel(item)
  const name = item.ingredient.name
  const need =
    item.neededQuantity !== undefined &&
    item.neededQuantity > 0 &&
    item.neededDisplayQuantity &&
    item.windowDays !== undefined
      ? // A vague quantity's display is the phrase itself, so it would read
        // "to taste needed in…" — drop it instead (HON-783).
        item.isVague
        ? tPantry('neededInWindowVague', { days: item.windowDays })
        : tPantry('neededInWindow', {
            quantity: item.neededDisplayQuantity,
            days: item.windowDays,
          })
      : null
  const shownAmount = hasAmount ? amountLabel : null

  return (
    // No entrance when a ticked shopping item lands here: it happens many
    // times a session, and the row appearing is the change (docs/DESIGN.md →
    // Reject list).
    <div className="@container flex flex-col gap-3 p-3">
      {/* A grid, so the stock control moves without moving in the DOM. In a
          row 28rem wide it sits on the name line, and the name keeps about
          160px past the star, the control and ⋯ (HON-1643). In a narrower
          row (a phone) it goes under the meta line, lined up with the name. */}
      <div className="grid-cols-pantry-row @md:grid-cols-pantry-row-wide grid items-center gap-x-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleToggle}
          disabled={isToggling}
          data-staple={item.id}
          aria-label={item.isStaple ? tPantry('ariaUnstaple') : tPantry('ariaToggleStaple')}
          className="col-start-1 row-start-1"
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
        <div className="col-start-2 row-start-1 min-w-0">
          <Body>{name}</Body>
        </div>
        {(shownAmount || need) && (
          <div className="col-span-2 col-start-2 row-start-2 @md:col-span-3 @md:col-start-2">
            {/* The caption is muted already, so the amount reads as one with the need. */}
            <Body variant="caption">{[shownAmount, need].filter(Boolean).join(' · ')}</Body>
          </div>
        )}
        {hasStock && (
          // `mt-2` under the meta line matches the 8px reach of each part's
          // 44px target, so it stays clear of the line above.
          <div className="col-span-2 col-start-2 row-start-3 mt-2 @md:col-span-1 @md:col-start-3 @md:row-start-1 @md:mt-0">
            <PantryStockControl
              pantryItemId={item.id}
              name={name}
              stock={stock}
              onStockChange={handleStockChange}
            />
          </div>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              ref={moreButtonRef}
              variant="ghost"
              size="icon-sm"
              data-more={item.id}
              aria-label={tPantry('moreActions', { name })}
              className="col-start-3 row-start-1 @md:col-start-4"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={handleMenuCloseAutoFocus}>
            {hasAmount && (
              <DropdownMenuItem onSelect={() => (pendingAction.current = 'amount')}>
                {amountLabel ? <PencilLine aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {amountLabel ? tPantry('changeAmount') : tPantry('addAmount')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => (pendingAction.current = 'remove')}
            >
              <Trash2 aria-hidden="true" />
              {tPantry('remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasAmount && isEditingAmount && (
        <PantryAmountField item={item} onSave={handleSaveAmount} onCancel={closeAmountField} />
      )}
    </div>
  )
}
