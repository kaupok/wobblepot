'use client'

import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { Body } from '@/components/ui/typography'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface ShoppingItemData {
  ingredientId: string
  name: string
  displayQuantity: string
  purchased: boolean
  neededByDate: string
  neededByRelative: string
  neededByAbsolute: string
  isVague?: boolean
  /**
   * Needed today (or overdue) in the household's timezone, computed by the API
   * against the same day as `neededByRelative`. The due label takes the
   * `warning` token, matching the Today card (HON-762).
   */
  dueToday?: boolean
}

interface ShoppingItemProps {
  item: ShoppingItemData
  onToggle: (ingredientId: string, purchased: boolean) => void
  disabled?: boolean
  pending?: boolean
  /**
   * Render the due label and its tooltip. `UrgencyGroup` turns it off in the
   * Today and Tomorrow groups, whose heading already says the day.
   */
  showDue?: boolean
}

export function ShoppingItem({
  item,
  onToggle,
  disabled,
  pending,
  showDue = true,
}: ShoppingItemProps) {
  const tShopping = useTranslations('shopping')
  const handleCheckedChange = (checked: boolean | 'indeterminate') => {
    if (checked === 'indeterminate') return
    onToggle(item.ingredientId, checked)
  }

  return (
    <label
      className={cn(
        'min-h-touch flex cursor-pointer items-center justify-between gap-3 p-3 transition-colors',
        // `accent`, not `muted`: the shopping note re-maps `--accent` to its
        // chip, so the wash stays yellow on the sheet (HON-1012).
        'hover:bg-accent/50',
        item.purchased && 'bg-accent/30',
        disabled && 'pointer-events-none opacity-50',
        pending && !disabled && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-3">
        <Checkbox
          checked={item.purchased}
          onCheckedChange={handleCheckedChange}
          disabled={disabled}
          aria-label={tShopping('ariaToggleItem', {
            name: item.name,
            state: item.purchased ? tShopping('stateNotPurchased') : tShopping('statePurchased'),
          })}
        />
        <div className="flex items-baseline gap-2">
          <Body
            tone={item.purchased ? 'muted' : 'default'}
            className={cn('transition-colors', item.purchased && 'line-through')}
          >
            {item.name}
          </Body>
          <Body
            variant="muted"
            className={cn(
              'transition-colors',
              item.purchased && 'line-through',
              item.isVague && 'italic',
            )}
          >
            {item.displayQuantity}
          </Body>
        </div>
      </div>
      {showDue && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'shrink-0 text-xs',
                item.purchased
                  ? 'text-muted-foreground/60'
                  : item.dueToday
                    ? 'text-warning font-medium'
                    : 'text-muted-foreground',
              )}
            >
              {item.neededByRelative}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {tShopping('neededByTooltip', { date: item.neededByAbsolute })}
          </TooltipContent>
        </Tooltip>
      )}
    </label>
  )
}
