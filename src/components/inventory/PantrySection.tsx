'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import { ChevronDown, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Body, Heading } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineAddItem } from '@/components/pantry/InlineAddItem'
import { cn } from '@/lib/utils'
import type { PantryItemData } from '@/components/pantry/PantryItem'

interface PantrySectionProps {
  items: PantryItemData[]
  onItemsChange: Dispatch<SetStateAction<PantryItemData[]>>
  newlyAddedIds?: Set<string>
  defaultOpen?: boolean
  collapsible?: boolean
  onPantryItemRemoved?: (ingredientId: string) => void
}

export function PantrySection({
  items,
  onItemsChange,
  newlyAddedIds = new Set(),
  defaultOpen = true,
  collapsible = false,
  onPantryItemRemoved,
}: PantrySectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
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

  const content = (
    <>
      {items.length === 0 ? (
        <div className="flex flex-col gap-4">
          <InlineAddItem onItemAdded={handleItemAdded} pantryIngredientIds={pantryIngredientIds} />
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Body variant="muted">{tPantry('empty')}</Body>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <InlineAddItem onItemAdded={handleItemAdded} pantryIngredientIds={pantryIngredientIds} />

          {staples.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Body variant="small" className="text-muted-foreground">
                  {tPantry('stapleSection')}
                </Body>
                <Body variant="muted">{tPantry('ingredientCount', { count: staples.length })}</Body>
              </div>
              <div className="flex flex-col gap-2">
                {staples.map((item) => (
                  <PantryItemRow
                    key={item.id}
                    item={item}
                    isNewlyAdded={newlyAddedIds.has(item.id)}
                    onToggleStaple={handleToggleStaple}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </div>
          )}

          {onHand.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Body variant="small" className="text-muted-foreground">
                  {tPantry('onHandSection')}
                </Body>
                <Body variant="muted">{tPantry('ingredientCount', { count: onHand.length })}</Body>
              </div>
              <div className="flex flex-col gap-2">
                {onHand.map((item) => (
                  <PantryItemRow
                    key={item.id}
                    item={item}
                    isNewlyAdded={newlyAddedIds.has(item.id)}
                    onToggleStaple={handleToggleStaple}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="border-t pt-3">
            <Body variant="muted" className="text-center">
              {tPantry('footerHint')}
            </Body>
          </div>
        </div>
      )}
    </>
  )

  if (collapsible) {
    return (
      <Card className="w-full">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between text-left">
                <div className="flex flex-col gap-1">
                  <Heading variant="h4">{tPantry('title')}</Heading>
                  <Body variant="muted">
                    {tPantry('ingredientCountInStock', { count: items.length })}
                  </Body>
                </div>
                <ChevronDown
                  className={cn(
                    'text-muted-foreground h-5 w-5 shrink-0 transition-transform duration-200',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-0">{content}</CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    )
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <Heading variant="h4">{tPantry('title')}</Heading>
        <Body variant="muted">{tPantry('subtitle')}</Body>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}

interface PantryItemRowProps {
  item: PantryItemData
  isNewlyAdded?: boolean
  onToggleStaple: (id: string, currentIsStaple: boolean) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

function PantryItemRow({
  item,
  isNewlyAdded = false,
  onToggleStaple,
  onRemove,
}: PantryItemRowProps) {
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
    <div
      className={cn(
        'flex items-center justify-between rounded-lg border p-3',
        isNewlyAdded && 'animate-in fade-in slide-in-from-top-2 duration-300',
      )}
    >
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
              'h-4 w-4',
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
                {tPantry('neededInWindow', {
                  quantity: item.neededDisplayQuantity,
                  days: item.windowDays,
                })}
              </Body>
            )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setShowRemoveDialog(true)}
        className="text-muted-foreground hover:text-destructive"
        aria-label={tPantry('ariaRemove', { name: item.ingredient.name })}
      >
        <Trash2 className="h-4 w-4" />
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
