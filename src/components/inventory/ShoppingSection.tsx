'use client'

import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Heading, Body } from '@/components/ui/typography'
import { CategoryGroup } from '@/components/shopping/CategoryGroup'
import { UrgencyGroup } from '@/components/shopping/UrgencyGroup'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { ShoppingEmptyState } from './ShoppingEmptyState'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { getUrgencyBucket, type UrgencyBucket } from '@/lib/meal-planning/dates'

type SortMode = 'category' | 'urgency'

const SORT_STORAGE_KEY = 'shopping-list-sort-mode'

interface ShoppingListGroup {
  category: IngredientCategory
  categoryLabel: string
  items: ShoppingItemData[]
}

interface ShoppingSectionProps {
  windowDays: number
  startDate: string
  endDate: string
  groups: ShoppingListGroup[]
  initialPurchasedIds: Set<string>
  onItemPurchased?: (item: PantryItemData) => void
  onItemUnpurchased?: (ingredientId: string) => void
  externalUnpurchasedIds?: Set<string>
  onExternalUnpurchaseProcessed?: () => void
}

function getInitialSortMode(): SortMode {
  if (typeof window === 'undefined') return 'category'
  const stored = localStorage.getItem(SORT_STORAGE_KEY)
  return stored === 'urgency' ? 'urgency' : 'category'
}

export function ShoppingSection({
  windowDays,
  startDate: _startDate,
  endDate: _endDate,
  groups,
  initialPurchasedIds,
  onItemPurchased,
  onItemUnpurchased,
  externalUnpurchasedIds,
  onExternalUnpurchaseProcessed,
}: ShoppingSectionProps) {
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(initialPurchasedIds)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('category')
  const [mounted, setMounted] = useState(false)

  // Initialize sort mode from localStorage after mount (SSR-safe)
  useEffect(() => {
    setSortMode(getInitialSortMode())
    setMounted(true)
  }, [])

  // Handle external unpurchase events (e.g., when pantry item is removed)
  useEffect(() => {
    if (!externalUnpurchasedIds || externalUnpurchasedIds.size === 0) return

    setPurchasedIds((prev) => {
      const next = new Set(prev)
      externalUnpurchasedIds.forEach((id) => next.delete(id))
      return next
    })

    // Clear the external set after processing to prevent stale reruns
    onExternalUnpurchaseProcessed?.()
  }, [externalUnpurchasedIds, onExternalUnpurchaseProcessed])

  const handleSortModeChange = (value: SortMode) => {
    setSortMode(value)
    localStorage.setItem(SORT_STORAGE_KEY, value)
  }

  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0)
  const purchasedCount = purchasedIds.size

  // Enhance items with current purchased state
  const enhancedGroups = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          purchased: purchasedIds.has(item.ingredientId),
        })),
      })),
    [groups, purchasedIds],
  )

  // For urgency mode: group all items by urgency bucket
  const urgencyGroups = useMemo(() => {
    if (sortMode !== 'urgency') return []

    const allItems = enhancedGroups.flatMap((group) => group.items)

    // Sort items by date (purchased items stay in their date position, not moved to bottom)
    const sortedItems = [...allItems].sort((a, b) => a.neededByDate.localeCompare(b.neededByDate))

    // Group by urgency bucket
    const bucketOrder: UrgencyBucket[] = ['today', 'tomorrow', 'this-week', 'later']
    const grouped = new Map<UrgencyBucket, ShoppingItemData[]>()

    for (const bucket of bucketOrder) {
      grouped.set(bucket, [])
    }

    for (const item of sortedItems) {
      const bucket = getUrgencyBucket(item.neededByDate)
      grouped.get(bucket)!.push(item)
    }

    // Return only non-empty groups in order
    return bucketOrder
      .filter((bucket) => grouped.get(bucket)!.length > 0)
      .map((bucket) => ({
        bucket,
        items: grouped.get(bucket)!,
      }))
  }, [enhancedGroups, sortMode])

  const getWindowLabel = () => {
    return windowDays === 14 ? 'Next 14 days' : 'Next 7 days'
  }

  const handleToggle = async (ingredientId: string, purchased: boolean) => {
    if (pendingIds.has(ingredientId)) return

    setPurchasedIds((prev) => {
      const next = new Set(prev)
      if (purchased) {
        next.add(ingredientId)
      } else {
        next.delete(ingredientId)
      }
      return next
    })
    setPendingIds((prev) => new Set(prev).add(ingredientId))

    try {
      const endpoint = purchased ? 'purchase' : 'unpurchase'
      const response = await fetch(`/api/shopping-list/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update item')
      }

      // Notify parent about pantry changes (for real-time update)
      if (purchased && onItemPurchased && data.results?.[0]?.pantryItem) {
        // Find the shopping item to get its quantity info
        const shoppingItem = groups
          .flatMap((g) => g.items)
          .find((item) => item.ingredientId === ingredientId)

        // Enhance pantry item with needed quantity data from shopping list
        const enhancedPantryItem = {
          ...data.results[0].pantryItem,
          ...(shoppingItem && {
            neededQuantity: 1, // Actual value doesn't matter for display, just needs to be > 0
            neededDisplayQuantity: shoppingItem.displayQuantity,
            windowDays,
          }),
        }
        onItemPurchased(enhancedPantryItem)
      } else if (!purchased && onItemUnpurchased && data.success) {
        onItemUnpurchased(ingredientId)
      }
    } catch (error) {
      setPurchasedIds((prev) => {
        const next = new Set(prev)
        if (purchased) {
          next.delete(ingredientId)
        } else {
          next.add(ingredientId)
        }
        return next
      })

      const message = error instanceof Error ? error.message : 'Failed to update item'
      toast.error(message)
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(ingredientId)
        return next
      })
    }
  }

  // Check if all items are purchased
  if (purchasedCount === totalItems && totalItems > 0) {
    return <ShoppingEmptyState variant="all-purchased" />
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>
              <Heading variant="h2">Shopping list</Heading>
            </CardTitle>
            <CardDescription>
              <Body variant="muted">
                {getWindowLabel()} · {totalItems} {totalItems === 1 ? 'item' : 'items'} ·{' '}
                {purchasedCount} purchased
              </Body>
            </CardDescription>
          </div>
          {mounted && (
            <Select value={sortMode} onValueChange={handleSortModeChange}>
              <SelectTrigger size="sm" className="w-[140px]" aria-label="Sort items">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="category">By category</SelectItem>
                <SelectItem value="urgency">By urgency</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {sortMode === 'category' ? (
            <div className="flex flex-col gap-6">
              {enhancedGroups.map((group) => (
                <CategoryGroup
                  key={group.category}
                  category={group.category}
                  categoryLabel={group.categoryLabel}
                  items={group.items}
                  onToggleItem={handleToggle}
                  disabled={pendingIds.size > 0}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {urgencyGroups.map((group) => (
                <UrgencyGroup
                  key={group.bucket}
                  bucket={group.bucket}
                  items={group.items}
                  onToggleItem={handleToggle}
                  disabled={pendingIds.size > 0}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
