'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Trash2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { CategoryGroup } from '@/components/shopping/CategoryGroup'
import { UrgencyGroup } from '@/components/shopping/UrgencyGroup'
import { ShoppingItem, type ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { CustomItemInput, type CustomItemData } from '@/components/shopping/CustomItemInput'
import { CustomShoppingItem } from '@/components/shopping/CustomShoppingItem'
import { ShoppingEmptyState } from './ShoppingEmptyState'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { getUrgencyBucket, type UrgencyBucket } from '@/lib/meal-planning/dates'

type SortMode = 'category' | 'urgency' | 'alphabetical'

type AlphabeticalItem =
  | { kind: 'computed'; item: ShoppingItemData }
  | { kind: 'custom'; item: CustomItemData }

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
  initialCustomItems?: CustomItemData[]
  onItemPurchased?: (item: PantryItemData) => void
  onItemUnpurchased?: (ingredientId: string) => void
  externalUnpurchasedIds?: Set<string>
  onExternalUnpurchaseProcessed?: () => void
}

function getInitialSortMode(): SortMode {
  if (typeof window === 'undefined') return 'category'
  const stored = localStorage.getItem(SORT_STORAGE_KEY)
  if (stored === 'urgency' || stored === 'alphabetical') return stored
  return 'category'
}

export function ShoppingSection({
  windowDays,
  startDate: _startDate,
  endDate: _endDate,
  groups,
  initialPurchasedIds,
  initialCustomItems = [],
  onItemPurchased,
  onItemUnpurchased,
  externalUnpurchasedIds,
  onExternalUnpurchaseProcessed,
}: ShoppingSectionProps) {
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(initialPurchasedIds)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('category')
  const [mounted, setMounted] = useState(false)
  const [customItems, setCustomItems] = useState<CustomItemData[]>(initialCustomItems)
  const [pendingCustomIds, setPendingCustomIds] = useState<Set<string>>(new Set())

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

  const totalComputedItems = groups.reduce((sum, group) => sum + group.items.length, 0)
  const purchasedComputedCount = purchasedIds.size
  const uncheckedCustomCount = customItems.filter((i) => !i.checked).length
  const checkedCustomCount = customItems.filter((i) => i.checked).length
  const totalItems = totalComputedItems + customItems.length
  const totalPurchased = purchasedComputedCount + checkedCustomCount

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

  // For alphabetical mode: flatten all items into a single A-Z sorted list
  const alphabeticalItems = useMemo(() => {
    if (sortMode !== 'alphabetical') return []

    const allItems: AlphabeticalItem[] = [
      ...enhancedGroups.flatMap((group) =>
        group.items.map((item) => ({ kind: 'computed' as const, item })),
      ),
      ...customItems.map((item) => ({ kind: 'custom' as const, item })),
    ]

    return allItems.sort((a, b) => {
      const aPurchased = a.kind === 'computed' ? a.item.purchased : a.item.checked
      const bPurchased = b.kind === 'computed' ? b.item.purchased : b.item.checked

      // Purchased/checked items sort to bottom
      if (aPurchased !== bPurchased) return aPurchased ? 1 : -1

      // Then sort alphabetically by name
      return a.item.name.localeCompare(b.item.name)
    })
  }, [enhancedGroups, customItems, sortMode])

  // Split custom items into linked (have category) and unlinked
  const { linkedCustomByCategory, unlinkedCustomItems } = useMemo(() => {
    const linked = new Map<string, CustomItemData[]>()
    const unlinked: CustomItemData[] = []

    for (const item of customItems) {
      if (item.ingredientCategory) {
        const existing = linked.get(item.ingredientCategory) ?? []
        existing.push(item)
        linked.set(item.ingredientCategory, existing)
      } else {
        unlinked.push(item)
      }
    }

    return { linkedCustomByCategory: linked, unlinkedCustomItems: unlinked }
  }, [customItems])

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

  const handleCustomItemAdded = useCallback((item: CustomItemData) => {
    setCustomItems((prev) => [item, ...prev])
  }, [])

  const handleCustomToggle = useCallback(
    async (id: string, checked: boolean) => {
      if (pendingCustomIds.has(id)) return

      // Optimistic update
      setCustomItems((prev) => prev.map((item) => (item.id === id ? { ...item, checked } : item)))
      setPendingCustomIds((prev) => new Set(prev).add(id))

      try {
        const response = await fetch(`/api/shopping-list/custom/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to update item')
        }
      } catch (error) {
        // Revert optimistic update
        setCustomItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, checked: !checked } : item)),
        )
        const message = error instanceof Error ? error.message : 'Failed to update item'
        toast.error(message)
      } finally {
        setPendingCustomIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [pendingCustomIds],
  )

  const handleCustomUnlink = useCallback(async (id: string) => {
    // Optimistic update
    setCustomItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, ingredientId: null, ingredientCategory: null } : item,
      ),
    )

    try {
      const response = await fetch(`/api/shopping-list/custom/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: null }),
      })

      if (!response.ok) {
        throw new Error('Failed to unlink item')
      }
    } catch {
      // Revert on error — refetch would be better but this is simpler for now
      toast.error('Failed to unlink item')
    }
  }, [])

  const handleCustomDelete = useCallback(async (id: string) => {
    // Optimistic update
    setCustomItems((prev) => prev.filter((item) => item.id !== id))

    try {
      const response = await fetch(`/api/shopping-list/custom/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to remove item')
      }
    } catch {
      toast.error('Failed to remove item')
    }
  }, [])

  const handleClearChecked = useCallback(async () => {
    const checkedIds = new Set(customItems.filter((i) => i.checked).map((i) => i.id))
    if (checkedIds.size === 0) return

    // Optimistic update
    setCustomItems((prev) => prev.filter((item) => !item.checked))

    try {
      const response = await fetch('/api/shopping-list/custom/checked', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to clear checked items')
      }
    } catch {
      toast.error('Failed to clear checked items')
    }
  }, [customItems])

  const isPending = pendingIds.size > 0 || pendingCustomIds.size > 0

  // Combined pending IDs for components that handle both computed and custom items
  const allPendingIds = useMemo(() => {
    if (pendingIds.size === 0 && pendingCustomIds.size === 0) return undefined
    const combined = new Set(pendingIds)
    pendingCustomIds.forEach((id) => combined.add(id))
    return combined
  }, [pendingIds, pendingCustomIds])

  // Check if all items are purchased/checked
  const allPurchased = totalPurchased === totalItems && totalItems > 0 && uncheckedCustomCount === 0

  if (allPurchased) {
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
                {totalPurchased} purchased
              </Body>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {checkedCustomCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearChecked}
                className="text-muted-foreground"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Clear checked
              </Button>
            )}
            {mounted && (
              <Select value={sortMode} onValueChange={handleSortModeChange}>
                <SelectTrigger size="sm" className="w-[150px]" aria-label="Sort items">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">By category</SelectItem>
                  <SelectItem value="urgency">By urgency</SelectItem>
                  <SelectItem value="alphabetical">Alphabetical</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          <CustomItemInput onItemAdded={handleCustomItemAdded} disabled={isPending} />

          {sortMode === 'category' && (
            <div className="flex flex-col gap-6">
              {enhancedGroups.map((group) => (
                <CategoryGroup
                  key={group.category}
                  category={group.category}
                  categoryLabel={group.categoryLabel}
                  items={group.items}
                  customItems={linkedCustomByCategory.get(group.category)}
                  onToggleItem={handleToggle}
                  onToggleCustomItem={handleCustomToggle}
                  onUnlinkCustomItem={handleCustomUnlink}
                  onDeleteCustomItem={handleCustomDelete}
                  pendingIds={allPendingIds}
                />
              ))}
              {/* Render category groups that only have custom items (no computed items) */}
              {Array.from(linkedCustomByCategory.entries())
                .filter(([cat]) => !enhancedGroups.some((g) => g.category === cat))
                .map(([category, items]) => (
                  <CategoryGroup
                    key={category}
                    category={category as IngredientCategory}
                    categoryLabel={category.charAt(0).toUpperCase() + category.slice(1)}
                    items={[]}
                    customItems={items}
                    onToggleItem={handleToggle}
                    onToggleCustomItem={handleCustomToggle}
                    onUnlinkCustomItem={handleCustomUnlink}
                    onDeleteCustomItem={handleCustomDelete}
                    pendingIds={allPendingIds}
                  />
                ))}
              {/* Unlinked custom items in "Other" section */}
              {unlinkedCustomItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Body variant="small" className="text-muted-foreground font-medium">
                      📝 Other ({unlinkedCustomItems.length})
                    </Body>
                    {unlinkedCustomItems.filter((i) => i.checked).length > 0 && (
                      <Body variant="muted">
                        {unlinkedCustomItems.filter((i) => i.checked).length}/
                        {unlinkedCustomItems.length}
                      </Body>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {unlinkedCustomItems.map((item) => (
                      <CustomShoppingItem
                        key={item.id}
                        item={item}
                        onToggle={handleCustomToggle}
                        onUnlink={handleCustomUnlink}
                        onDelete={handleCustomDelete}
                        pending={pendingCustomIds.has(item.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {sortMode === 'urgency' && (
            <div className="flex flex-col gap-6">
              {urgencyGroups.map((group) => (
                <UrgencyGroup
                  key={group.bucket}
                  bucket={group.bucket}
                  items={group.items}
                  onToggleItem={handleToggle}
                  pendingIds={pendingIds}
                />
              ))}
              {/* In urgency mode, show all custom items in a single "Custom items" group */}
              {customItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Body variant="small" className="text-muted-foreground font-medium">
                      📝 Custom items ({customItems.length})
                    </Body>
                    {checkedCustomCount > 0 && (
                      <Body variant="muted">
                        {checkedCustomCount}/{customItems.length}
                      </Body>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {customItems.map((item) => (
                      <CustomShoppingItem
                        key={item.id}
                        item={item}
                        onToggle={handleCustomToggle}
                        onUnlink={handleCustomUnlink}
                        onDelete={handleCustomDelete}
                        pending={pendingCustomIds.has(item.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {sortMode === 'alphabetical' && (
            <div className="flex flex-col gap-1">
              {alphabeticalItems.map((entry) =>
                entry.kind === 'computed' ? (
                  <ShoppingItem
                    key={entry.item.ingredientId}
                    item={entry.item}
                    onToggle={handleToggle}
                    pending={pendingIds.has(entry.item.ingredientId)}
                  />
                ) : (
                  <CustomShoppingItem
                    key={entry.item.id}
                    item={entry.item}
                    onToggle={handleCustomToggle}
                    onUnlink={handleCustomUnlink}
                    onDelete={handleCustomDelete}
                    pending={pendingCustomIds.has(entry.item.id)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
