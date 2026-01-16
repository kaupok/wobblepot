'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { Button } from '@/components/ui/button'
import { PantrySection } from './PantrySection'
import { ShoppingSection } from './ShoppingSection'
import { ShoppingEmptyState, type ShoppingEmptyStateVariant } from './ShoppingEmptyState'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'

interface ShoppingListGroup {
  category: IngredientCategory
  categoryLabel: string
  items: ShoppingItemData[]
}

interface ShoppingData {
  planId: string
  planStartDate: string
  planEndDate: string
  groups: ShoppingListGroup[]
  initialPurchasedIds: Set<string>
}

interface InventoryPageProps {
  pantryItems: PantryItemData[]
  shoppingData: ShoppingData | null
  emptyStateVariant?: ShoppingEmptyStateVariant
}

export function InventoryPage({
  pantryItems: initialPantryItems,
  shoppingData,
  emptyStateVariant,
}: InventoryPageProps) {
  const [isMobile, setIsMobile] = useState(false)
  const [pantryItems, setPantryItems] = useState<PantryItemData[]>(initialPantryItems)
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

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
      // Add new item
      return [...prev, newItem]
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
    }, 500)
  }, [])

  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="mb-4 flex items-center justify-between md:hidden">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to plan
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Pantry section - on mobile it's collapsible and comes second, on desktop it's first */}
        <div className="order-2 md:order-1">
          <PantrySection
            items={pantryItems}
            onItemsChange={setPantryItems}
            newlyAddedIds={newlyAddedIds}
            defaultOpen={!isMobile}
            collapsible={isMobile}
          />
        </div>

        {/* Shopping section - primary content, always first on mobile */}
        <div className="order-1 md:order-2">
          {emptyStateVariant ? (
            <ShoppingEmptyState variant={emptyStateVariant} />
          ) : shoppingData ? (
            <ShoppingSection
              planId={shoppingData.planId}
              planStartDate={shoppingData.planStartDate}
              planEndDate={shoppingData.planEndDate}
              groups={shoppingData.groups}
              initialPurchasedIds={shoppingData.initialPurchasedIds}
              onItemPurchased={handleItemPurchased}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
