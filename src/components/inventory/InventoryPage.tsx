'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { PantrySection } from './PantrySection'
import { ShoppingSection } from './ShoppingSection'
import { ShoppingEmptyState, type ShoppingEmptyStateVariant } from './ShoppingEmptyState'
import { useWindowReconcile } from './use-shopping-window'
import { cn } from '@/lib/utils'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'

interface ShoppingListGroup {
  category: IngredientCategory
  items: ShoppingItemData[]
}

interface ShoppingData {
  windowDays: number
  startDate: string
  endDate: string
  groups: ShoppingListGroup[]
  initialPurchasedIds: Set<string>
  customItems?: CustomItemData[]
}

/** Which half a phone sees. From `md` up both render, whichever route it is. */
export type InventoryView = 'shopping' | 'pantry'

interface InventoryPageProps {
  /**
   * `/shopping` passes `'shopping'`, `/pantry` passes `'pantry'` (HON-776).
   * Below `md` only that section renders visibly; the other is `hidden
   * md:block`, so server and client render the same tree.
   */
  view: InventoryView
  pantryItems: PantryItemData[]
  shoppingData: ShoppingData | null
  emptyStateVariant?: ShoppingEmptyStateVariant
  windowDays?: number
  /**
   * Whether `?days=` named the window explicitly. `page.tsx` collapses an
   * absent and an unparseable param into the same default, so the reconcile
   * needs this bit to tell an expressed intent from a fallback.
   */
  windowDaysFromUrl?: boolean
}

export function InventoryPage({
  view,
  pantryItems: initialPantryItems,
  shoppingData,
  emptyStateVariant,
  windowDays,
  windowDaysFromUrl = false,
}: InventoryPageProps) {
  const router = useRouter()

  // Applies a saved 7/14-day preference to the URL. Here rather than in
  // `ShoppingListHeader` because this component renders on every `/shopping`
  // and `/pantry` visit and exactly once, so the reconcile reaches the
  // header-less states (`no-plan`, `error`) and can never fire twice.
  useWindowReconcile(windowDays ?? 7, windowDaysFromUrl)
  const [pantryItems, setPantryItems] = useState<PantryItemData[]>(initialPantryItems)
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set())
  const [removedIngredientIds, setRemovedIngredientIds] = useState<Set<string>>(new Set())

  const handleItemPurchased = useCallback((newItem: PantryItemData) => {
    setPantryItems((prev) => {
      // Check if item already exists
      const existingIndex = prev.findIndex((item) => item.ingredient.id === newItem.ingredient.id)
      if (existingIndex !== -1) {
        // Update existing item
        const updated = [...prev]
        updated[existingIndex] = newItem
        return updated
      }
      // Add new item and sort alphabetically by ingredient name
      return [...prev, newItem].sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name))
    })
    // Track new items for animation
    setNewlyAddedIds((prev) => new Set(prev).add(newItem.id))
    // Remove from animation set after animation completes
    setTimeout(() => {
      setNewlyAddedIds((prev) => {
        const next = new Set(prev)
        next.delete(newItem.id)
        return next
      })
    }, 300)
  }, [])

  const handleItemUnpurchased = useCallback((ingredientId: string) => {
    setPantryItems((prev) => prev.filter((item) => item.ingredient.id !== ingredientId))
  }, [])

  const handlePantryItemRemoved = useCallback(
    (ingredientId: string) => {
      // Add to removed set to trigger shopping list update (for visual uncheck)
      setRemovedIngredientIds((prev) => new Set(prev).add(ingredientId))
      // Refresh the page data to recompute shopping list (item may now be needed)
      router.refresh()
    },
    [router],
  )

  const handleExternalUnpurchaseProcessed = useCallback(() => {
    // Clear the set after ShoppingSection has processed it
    setRemovedIngredientIds(new Set())
  }, [])

  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Pantry left, list right from `md`; a phone sees only `view`'s half. */}
        <div className={cn(view !== 'pantry' && 'hidden md:block')} data-testid="pantry-column">
          <PantrySection
            items={pantryItems}
            onItemsChange={setPantryItems}
            newlyAddedIds={newlyAddedIds}
            onPantryItemRemoved={handlePantryItemRemoved}
          />
        </div>

        <div className={cn(view !== 'shopping' && 'hidden md:block')} data-testid="shopping-column">
          {emptyStateVariant ? (
            <ShoppingEmptyState variant={emptyStateVariant} windowDays={windowDays} />
          ) : shoppingData ? (
            <ShoppingSection
              windowDays={shoppingData.windowDays}
              startDate={shoppingData.startDate}
              endDate={shoppingData.endDate}
              groups={shoppingData.groups}
              initialPurchasedIds={shoppingData.initialPurchasedIds}
              initialCustomItems={shoppingData.customItems}
              onItemPurchased={handleItemPurchased}
              onItemUnpurchased={handleItemUnpurchased}
              externalUnpurchasedIds={removedIngredientIds}
              onExternalUnpurchaseProcessed={handleExternalUnpurchaseProcessed}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
