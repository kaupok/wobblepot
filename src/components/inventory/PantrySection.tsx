'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import { Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Body, Heading } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineAddItem } from '@/components/pantry/InlineAddItem'
import { cn } from '@/lib/utils'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { GroupHeading } from './GroupHeading'

interface PantrySectionProps {
  items: PantryItemData[]
  onItemsChange: Dispatch<SetStateAction<PantryItemData[]>>
  /**
   * The pantry could not be fetched. Renders an error in place of the list, so
   * a failed load is never shown as "Your pantry is empty" — and hides the add
   * search, which would otherwise build a pantry on top of one it cannot see.
   */
  loadFailed?: boolean
  onPantryItemRemoved?: (ingredientId: string) => void
}

export function PantrySection({
  items,
  onItemsChange,
  loadFailed = false,
  onPantryItemRemoved,
}: PantrySectionProps) {
  const tPantry = useTranslations('pantry')

  const staples = items.filter((item) => item.isStaple)
  const onHand = items.filter((item) => !item.isStaple)

  const handleToggleStaple = async (id: string, currentIsStaple: boolean) => {
    onItemsChange((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isStaple: !currentIsStaple } : item)),
    )

    try {
      const response = await fetch(`/api/pantry/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isStaple: !currentIsStaple }),
      })

      if (!response.ok) {
        throw new Error(tPantry('errors.updateFailed'))
      }
    } catch {
      onItemsChange((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isStaple: currentIsStaple } : item)),
      )
      toast.error(tPantry('errors.updateFailed'))
    }
  }

  const handleRemove = async (id: string) => {
    const removedItem = items.find((item) => item.id === id)
    onItemsChange((prev) => prev.filter((item) => item.id !== id))

    try {
      const response = await fetch(`/api/pantry/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(tPantry('errors.removeFailed'))
      }

      toast.success(tPantry('success.removed'))

      // Notify parent so shopping list can uncheck this item
      if (removedItem && onPantryItemRemoved) {
        onPantryItemRemoved(removedItem.ingredient.id)
      }
    } catch {
      if (removedItem) {
        onItemsChange((prev) => [...prev, removedItem])
      }
      toast.error(tPantry('errors.removeFailed'))
    }
  }

  const handleItemAdded = (newItem: PantryItemData) => {
    onItemsChange((prev) => [...prev, newItem])
  }

  // Create a set of ingredient IDs currently in pantry for the search indicator
  const pantryIngredientIds = new Set(items.map((item) => item.ingredient.id))

  const content = loadFailed ? (
    <div role="alert">
      <Body tone="destructive">{tPantry('loadFailed')}</Body>
    </div>
  ) : items.length === 0 ? (
    <>
      <InlineAddItem onItemAdded={handleItemAdded} pantryIngredientIds={pantryIngredientIds} />
      <Body variant="muted">{tPantry('empty')}</Body>
    </>
  ) : (
    <>
      <InlineAddItem onItemAdded={handleItemAdded} pantryIngredientIds={pantryIngredientIds} />

      {staples.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupHeading
            label={tPantry('stapleSection')}
            count={tPantry('ingredientCount', { count: staples.length })}
          />
          <div className="flex flex-col gap-2">
            {staples.map((item) => (
              <PantryItemRow
                key={item.id}
                item={item}
                onToggleStaple={handleToggleStaple}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </div>
      )}

      {onHand.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupHeading
            label={tPantry('onHandSection')}
            count={tPantry('ingredientCount', { count: onHand.length })}
          />
          <div className="flex flex-col gap-2">
            {onHand.map((item) => (
              <PantryItemRow
                key={item.id}
                item={item}
                onToggleStaple={handleToggleStaple}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </div>
      )}

      <Body variant="muted">{tPantry('footerHint')}</Body>
    </>
  )

  // Title and subtitle on the page background, the rows the only bordered
  // things under them — the same shape as the list beside it and the
  // timeline on Today (docs/DESIGN.md → Composition rules, "Headings divide,
  // borders contain"). `gap-6` between the header, the search and each group.
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Heading variant="h4" as="h2">
          {tPantry('title')}
        </Heading>
        <Body variant="muted">{tPantry('subtitle')}</Body>
      </div>
      {content}
    </section>
  )
}

interface PantryItemRowProps {
  item: PantryItemData
  onToggleStaple: (id: string, currentIsStaple: boolean) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

/**
 * The pantry row `/shopping` actually renders. Exported so
 * `PantryItemRowSkeleton` can be measured against it — the placeholder is a
 * copy of this box, and a copy nothing points at is how HON-628 happened.
 * (`components/pantry/PantryItem.tsx` is a near-duplicate with no callsite of
 * its own; only its `PantryItemData` type is used.)
 */
export function PantryItemRow({ item, onToggleStaple, onRemove }: PantryItemRowProps) {
  const tPantry = useTranslations('pantry')
  const [isToggling, setIsToggling] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)

  const handleToggle = async () => {
    setIsToggling(true)
    try {
      await onToggleStaple(item.id, item.isStaple)
    } finally {
      setIsToggling(false)
    }
  }

  const handleRemove = async () => {
    setIsRemoving(true)
    try {
      await onRemove(item.id)
      setShowRemoveDialog(false)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    // No entrance when a ticked shopping item lands here: it happens many
    // times a session, and the row appearing is the change (docs/DESIGN.md →
    // Reject list).
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleToggle}
          disabled={isToggling}
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
        </div>
      </div>
      <Button
        variant="quiet-destructive"
        size="icon-sm"
        onClick={() => setShowRemoveDialog(true)}
        aria-label={tPantry('ariaRemove', { name: item.ingredient.name })}
      >
        <Trash2 className="size-4" />
      </Button>

      <ConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        title={tPantry('removeDialog.title')}
        description={tPantry('removeDialog.description', { name: item.ingredient.name })}
        confirmLabel={tPantry('removeDialog.confirm')}
        variant="destructive"
        onConfirm={handleRemove}
        isLoading={isRemoving}
      />
    </div>
  )
}
