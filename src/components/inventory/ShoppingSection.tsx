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
import { ShoppingItem, type ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { ShoppingEmptyState } from './ShoppingEmptyState'
import type { PantryItemData } from '@/components/pantry/PantryItem'

type SortMode = 'category' | 'urgency'

const SORT_STORAGE_KEY = 'shopping-list-sort-mode'

interface ShoppingListGroup {
  category: IngredientCategory
  categoryLabel: string
  items: ShoppingItemData[]
}

interface ShoppingSectionProps {
  planId: string
  planStartDate: string
  planEndDate: string
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
  planId,
  planStartDate,
  planEndDate,
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

  // For urgency mode: flatten all items and sort by date
  const urgencySortedItems = useMemo(() => {
    if (sortMode !== 'urgency') return []
    const allItems = enhancedGroups.flatMap((group) => group.items)
    // Sort by: unpurchased first, then by neededByDate ASC
    return [...allItems].sort((a, b) => {
      if (a.purchased !== b.purchased) {
        return a.purchased ? 1 : -1
      }
      return a.neededByDate.localeCompare(b.neededByDate)
    })
  }, [enhancedGroups, sortMode])

  const formatDateRange = (start: string, end: string) => {
    const startDate = new Date(start + 'T00:00:00')
    const endDate = new Date(end + 'T00:00:00')
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

    const startStr = startDate.toLocaleDateString('en-US', options)
    const endStr = endDate.toLocaleDateString('en-US', options)
    const year = endDate.getFullYear()

    return `${startStr} - ${endStr}, ${year}`
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
      const response = await fetch(`/api/meal-plans/${planId}/shopping-list/${endpoint}`, {
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
        onItemPurchased(data.results[0].pantryItem)
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
        <div className="flex flex-col gap-1">
          <CardTitle>
            <Heading variant="h2">Shopping list</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">For: {formatDateRange(planStartDate, planEndDate)}</Body>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3">
            <Body variant="muted">
              {totalItems} {totalItems === 1 ? 'item' : 'items'} • {purchasedCount} purchased
            </Body>
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
            <div className="flex flex-col gap-1">
              {urgencySortedItems.map((item) => (
                <ShoppingItem
                  key={item.ingredientId}
                  item={item}
                  onToggle={handleToggle}
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
