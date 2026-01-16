'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import { ChevronDown, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
        throw new Error('Failed to update item')
      }
    } catch {
      onItemsChange((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isStaple: currentIsStaple } : item)),
      )
      toast.error('Failed to update item')
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
        throw new Error('Failed to remove item')
      }

      toast.success('Item removed from pantry')

      // Notify parent so shopping list can uncheck this item
      if (removedItem && onPantryItemRemoved) {
        onPantryItemRemoved(removedItem.ingredient.id)
      }
    } catch {
      if (removedItem) {
        onItemsChange((prev) => [...prev, removedItem])
      }
      toast.error('Failed to remove item')
    }
  }

  const handleItemAdded = (newItem: PantryItemData) => {
    onItemsChange((prev) => [...prev, newItem])
    toast.success('Item added to pantry')
  }

  // Create a set of ingredient IDs currently in pantry for the search indicator
  const pantryIngredientIds = new Set(items.map((item) => item.ingredient.id))

  const content = (
    <>
      {items.length === 0 ? (
        <div className="flex flex-col gap-4">
          <InlineAddItem onItemAdded={handleItemAdded} pantryIngredientIds={pantryIngredientIds} />
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Body variant="muted">
              Your pantry is empty. Add staples like olive oil, salt, and rice to exclude them from
              shopping lists.
            </Body>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <InlineAddItem onItemAdded={handleItemAdded} pantryIngredientIds={pantryIngredientIds} />

          {staples.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Body variant="small" className="text-muted-foreground">
                  Staples (always stocked)
                </Body>
                <Body variant="muted">
                  {staples.length} {staples.length === 1 ? 'item' : 'items'}
                </Body>
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
                  On hand
                </Body>
                <Body variant="muted">
                  {onHand.length} {onHand.length === 1 ? 'item' : 'items'}
                </Body>
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
              Mark items as staples to exclude them from shopping lists
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
                  <CardTitle>
                    <Heading variant="h2">Your pantry</Heading>
                  </CardTitle>
                  <CardDescription>
                    <Body variant="muted">
                      {items.length} {items.length === 1 ? 'item' : 'items'} in stock
                    </Body>
                  </CardDescription>
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
        <CardTitle>
          <Heading variant="h2">Your pantry</Heading>
        </CardTitle>
        <CardDescription>
          <Body variant="muted">Manage your household inventory</Body>
        </CardDescription>
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
          size="icon"
          onClick={handleToggle}
          disabled={isToggling}
          className="h-8 w-8"
          aria-label={item.isStaple ? 'Remove from staples' : 'Mark as staple'}
        >
          <Star
            className={cn(
              'h-4 w-4',
              item.isStaple
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-muted-foreground hover:text-yellow-400',
            )}
          />
        </Button>
        <Body>{item.ingredient.name}</Body>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setShowRemoveDialog(true)}
        className="text-muted-foreground hover:text-destructive h-8 w-8"
        aria-label={`Remove ${item.ingredient.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <ConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        title="Remove from pantry"
        description={`Are you sure you want to remove ${item.ingredient.name} from your pantry?`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleRemove}
        isLoading={isRemoving}
      />
    </div>
  )
}
