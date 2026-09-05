'use client'

import { useTranslations } from 'next-intl'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'
import { Body } from '@/components/ui/typography'
import { ShoppingItem, type ShoppingItemData } from './ShoppingItem'

/**
 * Bucket → `dates.urgency` key. Exported so the clipboard export in
 * `ShoppingSection` reuses it rather than re-declaring the mapping.
 */
export const URGENCY_KEYS: Record<UrgencyBucket, 'today' | 'tomorrow' | 'thisWeek' | 'later'> = {
  today: 'today',
  tomorrow: 'tomorrow',
  'this-week': 'thisWeek',
  later: 'later',
}

interface UrgencyGroupProps {
  bucket: UrgencyBucket
  items: ShoppingItemData[]
  onToggleItem: (ingredientId: string, purchased: boolean) => void
  disabled?: boolean
  pendingIds?: Set<string>
}

export function UrgencyGroup({
  bucket,
  items,
  onToggleItem,
  disabled,
  pendingIds,
}: UrgencyGroupProps) {
  const tUrgency = useTranslations('dates.urgency')
  const label = tUrgency(URGENCY_KEYS[bucket])
  const purchasedCount = items.filter((item) => item.purchased).length
  const totalCount = items.length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Body variant="small" className="text-muted-foreground font-medium">
          {label} ({totalCount})
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
      </div>
    </div>
  )
}
