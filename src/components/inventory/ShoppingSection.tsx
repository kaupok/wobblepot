'use client'

import { useState, useEffect, useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
import {
  buildAlphabeticalItems,
  buildUrgencyGroups,
  getInitialSortMode,
  splitCustomItems,
  SORT_STORAGE_KEY,
  type SortMode,
} from './shopping-sort'
import { useCustomShoppingItems } from './use-custom-shopping-items'

interface ShoppingListGroup {
  category: IngredientCategory
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
  const tShopping = useTranslations('shopping')
  const tErrors = useTranslations('shopping.errors')
  const tSort = useTranslations('shopping.sort')
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(initialPurchasedIds)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('category')
  const [mounted, setMounted] = useState(false)

  const {
    customItems,
    pendingCustomIds,
    checkedCustomCount,
    uncheckedCustomCount,
    handleCustomItemAdded,
    handleCustomToggle,
    handleCustomUnlink,
    handleCustomDelete,
    handleClearChecked,
  } = useCustomShoppingItems(initialCustomItems)

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

  // Only the active mode's grouping is computed; the others stay empty.
  const urgencyGroups = useMemo(
    () =>
      sortMode === 'urgency'
        ? buildUrgencyGroups(enhancedGroups.flatMap((group) => group.items))
        : [],
    [enhancedGroups, sortMode],
  )

  const alphabeticalItems = useMemo(
    () =>
      sortMode === 'alphabetical'
        ? buildAlphabeticalItems(
            enhancedGroups.flatMap((group) => group.items),
            customItems,
          )
        : [],
    [enhancedGroups, customItems, sortMode],
  )

  const { linkedCustomByCategory, unlinkedCustomItems } = useMemo(
    () => splitCustomItems(customItems),
    [customItems],
  )

  const getWindowLabel = () => {
    return windowDays === 14 ? tShopping('windowNext14') : tShopping('windowNext7')
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
        throw new Error(data.error || tErrors('updateFailed'))
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

      const message = error instanceof Error ? error.message : tErrors('updateFailed')
      toast.error(message)
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(ingredientId)
        return next
      })
    }
  }

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
            <Heading variant="h4">{tShopping('title')}</Heading>
            <Body variant="muted">
              {getWindowLabel()} · {tShopping('itemCount', { count: totalItems })} ·{' '}
              {tShopping('purchasedTail', { count: totalPurchased })}
            </Body>
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
                {tShopping('clearChecked')}
              </Button>
            )}
            {mounted && (
              <Select value={sortMode} onValueChange={handleSortModeChange}>
                <SelectTrigger size="sm" className="w-[150px]" aria-label={tShopping('ariaSort')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">{tSort('category')}</SelectItem>
                  <SelectItem value="urgency">{tSort('urgency')}</SelectItem>
                  <SelectItem value="alphabetical">{tSort('alphabetical')}</SelectItem>
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
                      {tShopping('otherSection', { count: unlinkedCustomItems.length })}
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
                      {tShopping('customItemsSection', { count: customItems.length })}
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
