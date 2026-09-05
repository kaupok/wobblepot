'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Check, Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
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
import { CategoryGroup, CATEGORY_EMOJI } from '@/components/shopping/CategoryGroup'
import { UrgencyGroup, URGENCY_KEYS } from '@/components/shopping/UrgencyGroup'
import { ShoppingItem, type ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { CustomItemInput, type CustomItemData } from '@/components/shopping/CustomItemInput'
import { CustomShoppingItem } from '@/components/shopping/CustomShoppingItem'
import { ShoppingEmptyState } from './ShoppingEmptyState'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { track } from '@/lib/analytics'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { formatDateRange } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import {
  formatShoppingListForClipboard,
  type ClipboardSection,
} from '@/lib/shopping/format-clipboard'
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
  startDate,
  endDate,
  groups,
  initialPurchasedIds,
  initialCustomItems = [],
  onItemPurchased,
  onItemUnpurchased,
  externalUnpurchasedIds,
  onExternalUnpurchaseProcessed,
}: ShoppingSectionProps) {
  const locale = useLocale() as Locale
  const tShopping = useTranslations('shopping')
  const tErrors = useTranslations('shopping.errors')
  const tSort = useTranslations('shopping.sort')
  const tCategory = useTranslations('enums.IngredientCategory')
  const tUrgency = useTranslations('dates.urgency')
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(initialPurchasedIds)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('category')
  const [mounted, setMounted] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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

  // Don't leave the "copied" checkmark timer running after unmount.
  useEffect(() => () => clearTimeout(copiedTimeoutRef.current), [])

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

  /**
   * Sections for the clipboard export, mirroring the grouping and ordering of
   * the active sort mode. Purchased/checked items are dropped — the paste is a
   * to-buy list — so every heading count is derived from the surviving lines
   * rather than from the on-screen total, which still includes them.
   */
  const buildClipboardSections = useCallback((): ClipboardSection[] => {
    const computedLine = (item: ShoppingItemData) => `${item.name} ${item.displayQuantity}`
    const customLine = (item: CustomItemData) => item.name
    const toBuy = (items: ShoppingItemData[]) => items.filter((item) => !item.purchased)
    const unchecked = (items: CustomItemData[]) => items.filter((item) => !item.checked)

    if (sortMode === 'alphabetical') {
      return [
        {
          heading: null,
          lines: alphabeticalItems
            .filter((entry) =>
              entry.kind === 'computed' ? !entry.item.purchased : !entry.item.checked,
            )
            .map((entry) =>
              entry.kind === 'computed' ? computedLine(entry.item) : customLine(entry.item),
            ),
        },
      ]
    }

    if (sortMode === 'urgency') {
      const sections: ClipboardSection[] = urgencyGroups.map((group) => {
        const lines = toBuy(group.items).map(computedLine)
        return { heading: `${tUrgency(URGENCY_KEYS[group.bucket])} (${lines.length})`, lines }
      })

      const customLines = unchecked(customItems).map(customLine)
      sections.push({
        heading: tShopping('customItemsSection', { count: customLines.length }),
        lines: customLines,
      })

      return sections
    }

    const categorySection = (
      category: IngredientCategory,
      items: ShoppingItemData[],
      linked: CustomItemData[] | undefined,
    ): ClipboardSection => {
      const lines = [...toBuy(items).map(computedLine), ...unchecked(linked ?? []).map(customLine)]
      return {
        heading: `${CATEGORY_EMOJI[category]} ${tCategory(category)} (${lines.length})`,
        lines,
      }
    }

    const sections: ClipboardSection[] = enhancedGroups.map((group) =>
      categorySection(group.category, group.items, linkedCustomByCategory.get(group.category)),
    )

    // Categories reached only by a custom item get their own group on screen too.
    for (const [category, items] of linkedCustomByCategory.entries()) {
      if (enhancedGroups.some((group) => group.category === category)) continue
      sections.push(categorySection(category as IngredientCategory, [], items))
    }

    const otherLines = unchecked(unlinkedCustomItems).map(customLine)
    sections.push({
      heading: tShopping('otherSection', { count: otherLines.length }),
      lines: otherLines,
    })

    return sections
  }, [
    alphabeticalItems,
    customItems,
    enhancedGroups,
    linkedCustomByCategory,
    sortMode,
    tCategory,
    tShopping,
    tUrgency,
    unlinkedCustomItems,
    urgencyGroups,
  ])

  const handleCopy = async () => {
    // Built synchronously, before any `await`: Safari drops the user-gesture
    // association if the clipboard write isn't the first thing the handler does.
    const sections = buildClipboardSections()
    const itemCount = sections.reduce((sum, section) => sum + section.lines.length, 0)
    const heading = tShopping('copyHeading', {
      range: formatDateRange(parseLocalDate(startDate), parseLocalDate(endDate), locale, {
        withYear: true,
      }),
    })
    const text = formatShoppingListForClipboard(heading, sections)

    if (!text) return

    // `navigator.clipboard` is undefined outside a secure context. Optional
    // chaining would resolve to `undefined` and fire a success toast on a copy
    // that never happened, so check explicitly.
    if (!navigator.clipboard?.writeText) {
      toast.error(tErrors('copyFailed'))
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(tShopping('copySuccess'))
      void track('shopping:list_copied', { source: 'shopping_list', item_count: itemCount })
      clearTimeout(copiedTimeoutRef.current)
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(tErrors('copyFailed'))
    }
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

  // The all-done case early-returns below, but "computed items all purchased,
  // custom items all checked" doesn't — so the copy button needs its own gate.
  const unpurchasedComputedCount = useMemo(
    () =>
      enhancedGroups.reduce(
        (sum, group) => sum + group.items.filter((item) => !item.purchased).length,
        0,
      ),
    [enhancedGroups],
  )
  const hasItemsToCopy = unpurchasedComputedCount + uncheckedCustomCount > 0

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
            {hasItemsToCopy && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="text-muted-foreground"
              >
                {copied ? (
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {tShopping('copyList')}
              </Button>
            )}
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
