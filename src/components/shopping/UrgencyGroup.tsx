'use client'

import { useTranslations } from 'next-intl'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'
import { GroupHeading } from '@/components/inventory/GroupHeading'
import { RowGroup } from '@/components/ui/row-group'
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
  // Today and Tomorrow are single days, and the heading already says which, so
  // the rows drop their own due label, as the plan page's UrgentShopping panel
  // does. This week and Later span several days, where the row's day adds to it.
  const showDue = bucket === 'this-week' || bucket === 'later'

  return (
    <div className="flex flex-col gap-2">
      <GroupHeading
        label={label}
        total={totalCount}
        count={purchasedCount > 0 && `${purchasedCount}/${totalCount}`}
      />
      <RowGroup>
        {items.map((item) => (
          <ShoppingItem
            key={item.ingredientId}
            item={item}
            onToggle={onToggleItem}
            disabled={disabled}
            pending={pendingIds?.has(item.ingredientId)}
            showDue={showDue}
          />
        ))}
      </RowGroup>
    </div>
  )
}
