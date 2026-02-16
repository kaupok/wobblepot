'use client'

import { X, Unlink } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Body } from '@/components/ui/typography'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CustomItemData } from './CustomItemInput'

const CATEGORY_LABELS: Record<string, string> = {
  protein: 'Protein',
  vegetable: 'Vegetable',
  fruit: 'Fruit',
  dairy: 'Dairy',
  carb: 'Carb',
  legume: 'Legume',
  fat: 'Fat',
  condiment: 'Condiment',
  spice: 'Spice',
}

interface CustomShoppingItemProps {
  item: CustomItemData
  onToggle: (id: string, checked: boolean) => void
  onUnlink: (id: string) => void
  onDelete: (id: string) => void
  disabled?: boolean
}

export function CustomShoppingItem({
  item,
  onToggle,
  onUnlink,
  onDelete,
  disabled,
}: CustomShoppingItemProps) {
  const handleCheckedChange = (checked: boolean | 'indeterminate') => {
    if (checked === 'indeterminate') return
    onToggle(item.id, checked)
  }

  return (
    <div
      className={cn(
        'flex min-h-[44px] items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
        'hover:bg-muted/50',
        item.checked && 'bg-muted/30',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <label className="flex flex-1 cursor-pointer items-center gap-3">
        <Checkbox
          checked={item.checked}
          onCheckedChange={handleCheckedChange}
          disabled={disabled}
          className="h-5 w-5"
          aria-label={`Mark ${item.name} as ${item.checked ? 'not purchased' : 'purchased'}`}
        />
        <div className="flex items-baseline gap-2">
          <Body
            className={cn(
              'transition-colors',
              item.checked && 'text-muted-foreground line-through',
            )}
          >
            {item.name}
          </Body>
          {item.ingredientCategory && (
            <Body variant="muted" className="text-xs">
              {CATEGORY_LABELS[item.ingredientCategory] ?? item.ingredientCategory}
            </Body>
          )}
        </div>
      </label>
      <div className="flex shrink-0 items-center gap-1">
        {item.ingredientId && !item.checked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onUnlink(item.id)}
                className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
                aria-label={`Unlink ${item.name} from ingredient`}
              >
                <Unlink className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Unlink from ingredient</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="text-muted-foreground hover:text-destructive rounded p-1 transition-colors"
              aria-label={`Remove ${item.name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Remove item</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
