'use client'

import { Check, Copy, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import {
  CATEGORY_EMOJI,
  CategoryGroup,
  CUSTOM_ITEMS_EMOJI,
} from '@/components/shopping/CategoryGroup'
import { type CustomItemData, CustomItemInput } from '@/components/shopping/CustomItemInput'
import { CustomShoppingItem } from '@/components/shopping/CustomShoppingItem'
import { ShoppingItem, type ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { URGENCY_KEYS, UrgencyGroup } from '@/components/shopping/UrgencyGroup'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RowGroup } from '@/components/ui/row-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Body } from '@/components/ui/typography'
import type { IngredientCategory } from '@/generated/prisma/enums'
import type { Locale } from '@/lib/i18n/locales'
import type { ClipboardSection } from '@/lib/shopping/format-clipboard'

import { GroupHeading } from './GroupHeading'
import {
  buildAlphabeticalItems,
  buildUrgencyGroups,
  DEFAULT_SORT_MODE,
  getInitialSortMode,
  SORT_STORAGE_KEY,
  type SortMode,
  splitCustomItems,
} from './shopping-sort'
import type { ShoppingEmptyStateVariant } from './ShoppingEmptyState'
import { ShoppingListHeader } from './ShoppingListHeader'
import { useCopyShoppingList } from './use-copy-shopping-list'
import { useCustomShoppingItems } from './use-custom-shopping-items'
import { useKeptTickedRows } from './use-kept-ticked-rows'
import { type PantryChange, usePantryChanges } from './use-pantry-changes'
import { usePurchaseToggle } from './use-purchase-toggle'

interface ShoppingListGroup {
  category: IngredientCategory
  items: ShoppingItemData[]
}

interface ShoppingSectionProps {
  /** Why the server's list came back empty; picks the line an empty sheet shows. */
  emptyVariant?: Exclude<ShoppingEmptyStateVariant, 'error'>
  windowDays: number
  startDate: string
  endDate: string
  groups: ShoppingListGroup[]
  initialPurchasedIds: Set<string>
  initialCustomItems?: CustomItemData[]
  onItemPurchased?: (item: PantryItemData) => void
  /** `restoredQuantity` is set when the pantry row stays at the amount it had before the tick. */
  onItemUnpurchased?: (ingredientId: string, restoredQuantity?: number) => void
  /** Pantry rows removed or put back (Undo), by ingredient id: `usePantryChanges`. */
  externalPantryChanges?: Map<string, PantryChange>
  onExternalPantryChangesProcessed?: (listStale: boolean) => void
}

export function ShoppingSection({
  emptyVariant,
  windowDays,
  startDate,
  endDate,
  groups,
  initialPurchasedIds,
  initialCustomItems = [],
  onItemPurchased,
  onItemUnpurchased,
  externalPantryChanges,
  onExternalPantryChangesProcessed,
}: ShoppingSectionProps) {
  const locale = useLocale() as Locale
  const tShopping = useTranslations('shopping')
  const tEmpty = useTranslations('shopping.emptyState')
  const tSort = useTranslations('shopping.sort')
  const tCategory = useTranslations('enums.IngredientCategory')
  const tUrgency = useTranslations('dates.urgency')
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(initialPurchasedIds)
  const [sortMode, setSortMode] = useState<SortMode>(DEFAULT_SORT_MODE)
  // The server's groups plus the ticked rows a re-read left out (HON-1439).
  const displayGroups = useKeptTickedRows(groups, purchasedIds, setPurchasedIds)

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

  // Apply the stored sort mode after mount. The server and the first client
  // render both use DEFAULT_SORT_MODE, so the select renders in the server HTML
  // with the default and switches to the stored mode a frame later (HON-771).
  useEffect(() => {
    // Reads localStorage after hydration, so the first render matches the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSortMode(getInitialSortMode())
  }, [])

  usePantryChanges(externalPantryChanges, onExternalPantryChangesProcessed, setPurchasedIds)

  const handleSortModeChange = (value: SortMode) => {
    setSortMode(value)
    localStorage.setItem(SORT_STORAGE_KEY, value)
  }

  // Enhance items with current purchased state
  const enhancedGroups = useMemo(
    () =>
      displayGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          purchased: purchasedIds.has(item.ingredientId),
        })),
      })),
    [displayGroups, purchasedIds],
  )

  const unpurchasedComputedCount = useMemo(
    () =>
      enhancedGroups.reduce(
        (sum, group) => sum + group.items.filter((item) => !item.purchased).length,
        0,
      ),
    [enhancedGroups],
  )
  // Counted from the rows on screen, not `purchasedIds`: an id can outlive its
  // row, and "bought" must never count a row the household cannot see.
  const totalComputedItems = enhancedGroups.reduce((sum, group) => sum + group.items.length, 0)
  const totalItems = totalComputedItems + customItems.length
  const totalPurchased = totalComputedItems - unpurchasedComputedCount + checkedCustomCount

  // Only the active mode's grouping is computed; the others stay empty.
  const urgencyGroups = useMemo(
    () =>
      sortMode === 'urgency'
        ? buildUrgencyGroups(
            enhancedGroups.flatMap((group) => group.items),
            customItems,
          )
        : [],
    [enhancedGroups, customItems, sortMode],
  )
  // A free-text extra's item sits under its day (HON-1310); the rest have none.
  const undatedCustomItems = useMemo(
    () => customItems.filter((item) => !item.neededBy),
    [customItems],
  )

  const alphabeticalItems = useMemo(
    () =>
      sortMode === 'alphabetical'
        ? buildAlphabeticalItems(
            enhancedGroups.flatMap((group) => group.items),
            customItems,
            locale,
          )
        : [],
    [enhancedGroups, customItems, sortMode, locale],
  )

  const { linkedCustomByCategory, unlinkedCustomItems } = useMemo(
    () => splitCustomItems(customItems),
    [customItems],
  )

  /**
   * Sections for the clipboard export, mirroring the grouping and ordering of
   * the active sort mode. Purchased/checked items are dropped — the paste is a
   * to-buy list — so every heading count is derived from the surviving lines
   * rather than from the on-screen total, which still includes them.
   */
  const buildClipboardSections = useCallback((): ClipboardSection[] => {
    // A ran-out staple with no amount (HON-1398) is the name alone.
    const computedLine = (item: ShoppingItemData) =>
      item.displayQuantity ? `${item.name} ${item.displayQuantity}` : item.name
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
      // Undated custom items lead, as on screen.
      const customLines = unchecked(undatedCustomItems).map(customLine)
      return [
        {
          heading: `${CUSTOM_ITEMS_EMOJI} ${tShopping('customItemsSection', { count: customLines.length })}`,
          lines: customLines,
        },
        ...urgencyGroups.map((group) => {
          const lines = [
            ...toBuy(group.items).map(computedLine),
            ...unchecked(group.customItems).map(customLine),
          ]
          return { heading: `${tUrgency(URGENCY_KEYS[group.bucket])} (${lines.length})`, lines }
        }),
      ]
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
      heading: `${CUSTOM_ITEMS_EMOJI} ${tShopping('otherSection', { count: otherLines.length })}`,
      lines: otherLines,
    })

    return sections
  }, [
    alphabeticalItems,
    enhancedGroups,
    linkedCustomByCategory,
    sortMode,
    tCategory,
    tShopping,
    tUrgency,
    undatedCustomItems,
    unlinkedCustomItems,
    urgencyGroups,
  ])

  const { copied, handleCopy } = useCopyShoppingList(buildClipboardSections, startDate, endDate)

  const { pendingIds, handleToggle } = usePurchaseToggle({
    groups: displayGroups,
    windowDays,
    setPurchasedIds,
    onItemPurchased,
    onItemUnpurchased,
  })

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

  // `allPurchased` covers every list that has items and has them all accounted
  // for, so what's left for this gate is the list with no items at all.
  // Without it the header would offer to copy an empty list.
  const hasItemsToCopy = unpurchasedComputedCount + uncheckedCustomCount > 0

  // An empty or fully bought list keeps the sheet and its Add field, with one
  // line under it that says why nothing is left to buy (HON-1354). It is derived
  // here, not taken from the server, so adding an item replaces it at once.
  // `emptyVariant` is unset for a list that loaded with custom items, so one
  // emptied by deleting them says only that it is empty.
  const emptyLine = allPurchased
    ? tEmpty('allDoneBody')
    : totalItems === 0
      ? emptyVariant === 'nothing-needed'
        ? tEmpty('nothingBody', { days: windowDays })
        : tEmpty('emptyBody')
      : null

  return (
    <section className="flex flex-col gap-6">
      <ShoppingListHeader
        windowDays={windowDays}
        summary={
          // The window itself is stated by the picker, so the summary is the
          // count and, once something is bought, the purchased tail. The
          // separator is kept on the line of the fragment after it, so a
          // phone-width wrap never starts a line with "·" (HON-783).
          <>
            {tShopping('itemCount', { count: totalItems })}
            {totalPurchased > 0 && (
              <>
                {' '}
                <span className="whitespace-nowrap">
                  · {tShopping('purchasedTail', { count: totalPurchased })}
                </span>
              </>
            )}
          </>
        }
      >
        {/* Label passed explicitly so the server HTML is not an empty trigger — see ShoppingListHeader. */}
        <Select value={sortMode} onValueChange={handleSortModeChange}>
          <SelectTrigger size="sm" className="w-37.5" aria-label={tShopping('ariaSort')}>
            <SelectValue>{tSort(sortMode)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="category">{tSort('category')}</SelectItem>
            <SelectItem value="urgency">{tSort('urgency')}</SelectItem>
            <SelectItem value="alphabetical">{tSort('alphabetical')}</SelectItem>
          </SelectContent>
        </Select>
        {hasItemsToCopy && (
          <>
            <Button variant="quiet" size="sm" onClick={handleCopy}>
              {copied ? (
                <Check className="mr-1 size-4" aria-hidden="true" />
              ) : (
                <Copy className="mr-1 size-4" aria-hidden="true" />
              )}
              {tShopping('copyList')}
            </Button>
            {/* Both icons are aria-hidden, so this is the checkmark for a screen
                reader. It mounts with the button and stays mounted, because a
                live region announces changes, not its first render. */}
            <span role="status" className="sr-only">
              {copied ? tShopping('copySuccess') : ''}
            </span>
          </>
        )}
        {checkedCustomCount > 0 && (
          <Button variant="quiet" size="sm" onClick={handleClearChecked}>
            <Trash2 className="mr-1 size-4" />
            {tShopping('clearChecked')}
          </Button>
        )}
      </ShoppingListHeader>
      {/* The list is the shopping note's sheet, the paper of Today's
          `UrgentShopping` (HON-1016). The title and controls stay on the page
          above it, level with the pantry's title and search; the sheet holds
          the Add field and the groups, whose rows are ruled rather than boxed
          because the sheet is already the container. */}
      <Card data-surface="note" data-testid="shopping-sheet">
        <CardContent>
          <div className="flex flex-col gap-6">
            <CustomItemInput onItemAdded={handleCustomItemAdded} disabled={isPending} />
            {emptyLine && <Body variant="muted">{emptyLine}</Body>}

            {/* `totalItems > 0`, here and for urgency: an empty mode wrapper is
                still a flex child, which adds a stray gap under the empty line. */}
            {sortMode === 'category' && totalItems > 0 && (
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
                    <GroupHeading
                      emoji={CUSTOM_ITEMS_EMOJI}
                      label={tShopping('otherSectionTitle')}
                      total={unlinkedCustomItems.length}
                      count={
                        unlinkedCustomItems.filter((i) => i.checked).length > 0 &&
                        `${unlinkedCustomItems.filter((i) => i.checked).length}/${unlinkedCustomItems.length}`
                      }
                    />
                    <RowGroup variant="ruled">
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
                    </RowGroup>
                  </div>
                )}
              </div>
            )}

            {sortMode === 'urgency' && totalItems > 0 && (
              <div className="flex flex-col gap-6">
                {/* Undated custom items lead in one "Custom items" group: a new
                one lands right under the input that added it. */}
                {undatedCustomItems.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <GroupHeading
                      emoji={CUSTOM_ITEMS_EMOJI}
                      label={tShopping('customItemsSectionTitle')}
                      total={undatedCustomItems.length}
                      count={
                        undatedCustomItems.some((i) => i.checked) &&
                        `${undatedCustomItems.filter((i) => i.checked).length}/${undatedCustomItems.length}`
                      }
                    />
                    <RowGroup variant="ruled">
                      {undatedCustomItems.map((item) => (
                        <CustomShoppingItem
                          key={item.id}
                          item={item}
                          onToggle={handleCustomToggle}
                          onUnlink={handleCustomUnlink}
                          onDelete={handleCustomDelete}
                          pending={pendingCustomIds.has(item.id)}
                        />
                      ))}
                    </RowGroup>
                  </div>
                )}
                {urgencyGroups.map((group) => (
                  <UrgencyGroup
                    key={group.bucket}
                    bucket={group.bucket}
                    items={group.items}
                    customItems={group.customItems}
                    onToggleItem={handleToggle}
                    onToggleCustomItem={handleCustomToggle}
                    onUnlinkCustomItem={handleCustomUnlink}
                    onDeleteCustomItem={handleCustomDelete}
                    pendingIds={allPendingIds}
                  />
                ))}
              </div>
            )}

            {/* `alphabeticalItems.length > 0`: a `RowGroup` with no rows is an
                empty flex child, which would add a stray gap under the Add
                field after an empty list's last custom item is deleted. */}
            {sortMode === 'alphabetical' && alphabeticalItems.length > 0 && (
              <RowGroup variant="ruled">
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
              </RowGroup>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
