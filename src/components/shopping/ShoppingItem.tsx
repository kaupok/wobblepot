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
}

interface ShoppingItemProps {
  item: ShoppingItemData
  onToggle: (ingredientId: string, purchased: boolean) => void
  disabled?: boolean
  pending?: boolean
}

export function ShoppingItem({ item, onToggle, disabled, pending }: ShoppingItemProps) {
  const tShopping = useTranslations('shopping')
  const handleCheckedChange = (checked: boolean | 'indeterminate') => {
    if (checked === 'indeterminate') return
    onToggle(item.ingredientId, checked)
  }

  return (
    <label
      className={cn(
        'flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
        'hover:bg-muted/50',
        item.purchased && 'bg-muted/30',
        disabled && 'pointer-events-none opacity-50',
        pending && !disabled && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-3">
        <Checkbox
          checked={item.purchased}
          onCheckedChange={handleCheckedChange}
          disabled={disabled}
          className="h-5 w-5"
          aria-label={tShopping('ariaToggleItem', {
            name: item.name,
            state: item.purchased ? tShopping('stateNotPurchased') : tShopping('statePurchased'),
          })}
        />
        <div className="flex items-baseline gap-2">
          <Body
            className={cn(
              'transition-colors',
              item.purchased && 'text-muted-foreground line-through',
            )}
          >
            {item.name}
          </Body>
          <Body
            variant="muted"
            className={cn(
              'transition-colors',
              item.purchased && 'text-muted-foreground/60 line-through',
              item.isVague && 'italic',
            )}
          >
            {item.displayQuantity}
          </Body>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'shrink-0 text-xs',
              item.purchased ? 'text-muted-foreground/60' : 'text-muted-foreground',
            )}
          >
            {item.neededByRelative}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tShopping('neededByTooltip', { date: item.neededByAbsolute })}</p>
        </TooltipContent>
      </Tooltip>
    </label>
  )
}
