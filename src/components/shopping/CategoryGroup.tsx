'use client'

import type { IngredientCategory } from '@/generated/prisma/enums'
import { Body } from '@/components/ui/typography'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { ShoppingItem, type ShoppingItemData } from './ShoppingItem'
import { CustomShoppingItem } from './CustomShoppingItem'
import type { CustomItemData } from './CustomItemInput'

/**
 * Emoji mapping for ingredient categories.
 * These provide visual context in the shopping list.
 *
 * Exported so the clipboard export in `ShoppingSection` reuses the same map —
 * a second copy would drift the first time a category is added.
 */
export const CATEGORY_EMOJI: Record<IngredientCategory, string> = {
  protein: '🥩',
  vegetable: '🥬',
  fruit: '🍎',
  dairy: '🧀',
  carb: '🍞',
  legume: '🫘',
  fat: '🫒',
  condiment: '🧂',
  spice: '🌿',
}

interface CategoryGroupProps {
  category: IngredientCategory
  items: ShoppingItemData[]
  customItems?: CustomItemData[]
  onToggleItem: (ingredientId: string, purchased: boolean) => void
  onToggleCustomItem?: (id: string, checked: boolean) => void
  onUnlinkCustomItem?: (id: string) => void
  onDeleteCustomItem?: (id: string) => void
  pendingIds?: Set<string>
  disabled?: boolean
}

export function CategoryGroup({
  category,
  items,
  customItems,
  onToggleItem,
  onToggleCustomItem,
  onUnlinkCustomItem,
  onDeleteCustomItem,
  pendingIds,
  disabled,
}: CategoryGroupProps) {
  const emoji = CATEGORY_EMOJI[category]
  const categoryLabel = useEnumLabel('IngredientCategory', category)
  const computedPurchasedCount = items.filter((item) => item.purchased).length
  const customCheckedCount = customItems?.filter((item) => item.checked).length ?? 0
  const totalCount = items.length + (customItems?.length ?? 0)
  const purchasedCount = computedPurchasedCount + customCheckedCount

  if (totalCount === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Body variant="small" className="text-muted-foreground font-medium">
          {emoji} {categoryLabel} ({totalCount})
        </Body>
        {purchasedCount > 0 && (
          <Body variant="muted">
            {purchasedCount}/{totalCount}
          </Body>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <ShoppingItem
            key={item.ingredientId}
            item={item}
            onToggle={onToggleItem}
            disabled={disabled}
            pending={pendingIds?.has(item.ingredientId)}
          />
        ))}
        {customItems?.map((item) => (
          <CustomShoppingItem
            key={item.id}
            item={item}
            onToggle={onToggleCustomItem ?? (() => {})}
            onUnlink={onUnlinkCustomItem ?? (() => {})}
            onDelete={onDeleteCustomItem ?? (() => {})}
            disabled={disabled}
            pending={pendingIds?.has(item.id)}
          />
        ))}
      </div>
    </div>
  )
}
