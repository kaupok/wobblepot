'use client'

import type { IngredientCategory } from '@/generated/prisma/enums'
import { Body } from '@/components/ui/typography'
import { ShoppingItem, type ShoppingItemData } from './ShoppingItem'

/**
 * Emoji mapping for ingredient categories.
 * These provide visual context in the shopping list.
 */
const CATEGORY_EMOJI: Record<IngredientCategory, string> = {
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
  categoryLabel: string
  items: ShoppingItemData[]
  onToggleItem: (ingredientId: string, purchased: boolean) => void
  disabled?: boolean
}

export function CategoryGroup({
  category,
  categoryLabel,
  items,
  onToggleItem,
  disabled,
}: CategoryGroupProps) {
  const emoji = CATEGORY_EMOJI[category]
  const purchasedCount = items.filter((item) => item.purchased).length
  const totalCount = items.length

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
          />
        ))}
      </div>
    </div>
  )
}
