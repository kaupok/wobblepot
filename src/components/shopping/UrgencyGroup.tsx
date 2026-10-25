'use client'

import { useTranslations } from 'next-intl'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'
import { GroupHeading } from '@/components/inventory/GroupHeading'
import { RowGroup } from '@/components/ui/row-group'
import { ShoppingItem, type ShoppingItemData } from './ShoppingItem'
import { CustomShoppingItem } from './CustomShoppingItem'
import type { CustomItemData } from './CustomItemInput'

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
  /** Manual items dated by a free-text day extra (HON-1310), after the computed lines. */
  customItems?: CustomItemData[]
  onToggleItem: (ingredientId: string, purchased: boolean) => void
  onToggleCustomItem?: (id: string, checked: boolean) => void
  onUnlinkCustomItem?: (id: string) => void
  onDeleteCustomItem?: (id: string) => void
  disabled?: boolean
  /** Computed lines by ingredient id, manual items by item id. */
  pendingIds?: Set<string>
}

export function UrgencyGroup({
  bucket,
  items,
  customItems,
  onToggleItem,
  onToggleCustomItem,
  onUnlinkCustomItem,
  onDeleteCustomItem,
  disabled,
  pendingIds,
}: UrgencyGroupProps) {
  const tUrgency = useTranslations('dates.urgency')
  const label = tUrgency(URGENCY_KEYS[bucket])
  const purchasedCount =
    items.filter((item) => item.purchased).length +
    (customItems?.filter((item) => item.checked).length ?? 0)
  const totalCount = items.length + (customItems?.length ?? 0)
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
      <RowGroup variant="ruled">
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
      </RowGroup>
    </div>
  )
}
