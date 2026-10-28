'use client'

import { Star, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { PantryItemData } from '@/components/pantry/PantryItem'

interface PantryItemRowProps {
  item: PantryItemData
  onToggleStaple: (id: string, currentIsStaple: boolean) => void
  onRemove: (item: PantryItemData) => void
  /** Marks a row at 0 as at home again. Shown only on a row at 0. */
  onHaveIt?: (item: PantryItemData) => void
  /** Marks a row as ran out. Shown on every row not at 0. */
  onRanOut?: (item: PantryItemData) => void
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
  isToggling = false,
}: PantryItemRowProps) {
  const tPantry = useTranslations('pantry')
  const isRanOut = item.quantity === 0

  const handleToggle = () => onToggleStaple(item.id, item.isStaple)

  return (
    // No entrance when a ticked shopping item lands here: it happens many
    // times a session, and the row appearing is the change (docs/DESIGN.md →
    // Reject list).
    <div className="flex items-center justify-between p-3">
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
          {/* A staple at 0 stays in Staples, so the row says it ran out; an
              ordinary row says it by its group. */}
          {isRanOut && item.isStaple && <Body variant="caption">{tPantry('ranOut')}</Body>}
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
      </div>
      <div className="flex items-center gap-2">
        {/* "Ran out" and "Have it" swap in one slot, at one size. */}
        {isRanOut && onHaveIt && (
          <Button
            variant="outline"
            size="sm-touch"
            onClick={() => onHaveIt(item)}
            data-have-it={item.id}
            aria-label={tPantry('ariaHaveIt', { name: item.ingredient.name })}
          >
            {tPantry('haveIt')}
          </Button>
        )}
        {!isRanOut && onRanOut && (
          <Button
            variant="outline"
            size="sm-touch"
            onClick={() => onRanOut(item)}
            data-ran-out={item.id}
            aria-label={tPantry('ariaRanOut', { name: item.ingredient.name })}
          >
            {tPantry('ranOut')}
          </Button>
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
  )
}
