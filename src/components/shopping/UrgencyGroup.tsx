'use client'

import { useTranslations } from 'next-intl'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'
import { GroupHeading } from '@/components/inventory/GroupHeading'
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
      <GroupHeading
        label={`${label} (${totalCount})`}
        count={purchasedCount > 0 && `${purchasedCount}/${totalCount}`}
      />
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
