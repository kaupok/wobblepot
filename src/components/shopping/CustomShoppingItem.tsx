'use client'

import { X, Unlink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Body } from '@/components/ui/typography'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { CustomItemData } from './CustomItemInput'

interface CustomShoppingItemProps {
  item: CustomItemData
  onToggle: (id: string, checked: boolean) => void
  onUnlink: (id: string) => void
  onDelete: (id: string) => void
  disabled?: boolean
  pending?: boolean
}

function CategoryBadge({ category }: { category: IngredientCategory }) {
  const label = useEnumLabel('IngredientCategory', category)
  return <Body variant="caption">{label}</Body>
}

export function CustomShoppingItem({
  item,
  onToggle,
  onUnlink,
  onDelete,
  disabled,
  pending,
}: CustomShoppingItemProps) {
  const tShopping = useTranslations('shopping')
  const handleCheckedChange = (checked: boolean | 'indeterminate') => {
    if (checked === 'indeterminate') return
    onToggle(item.id, checked)
  }

  return (
    <div
      className={cn(
        'min-h-touch flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
        'hover:bg-muted/50',
        item.checked && 'bg-muted/30',
        disabled && 'pointer-events-none opacity-50',
        pending && !disabled && 'opacity-70',
      )}
    >
      <label className="flex flex-1 cursor-pointer items-center gap-3">
        <Checkbox
          checked={item.checked}
          onCheckedChange={handleCheckedChange}
          disabled={disabled}
          className="h-5 w-5"
          aria-label={tShopping('ariaToggleItem', {
            name: item.name,
            state: item.checked ? tShopping('stateNotPurchased') : tShopping('statePurchased'),
          })}
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
            <CategoryBadge category={item.ingredientCategory as IngredientCategory} />
          )}
        </div>
      </label>
      {/* `-my-0.5` lets the 32px `icon-sm` actions reach 2px into the row's
          `p-3` instead of growing the row past the 28px name line — the row
          stays the same height as `ShoppingItem`, which
          `ShoppingItemSkeleton.stories.tsx` holds both to. */}
      <div className="-my-0.5 flex shrink-0 items-center gap-1">
        {item.ingredientId && !item.checked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onUnlink(item.id)}
                className="text-muted-foreground"
                aria-label={tShopping('ariaUnlink', { name: item.name })}
              >
                <Unlink className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{tShopping('unlinkTooltip')}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(item.id)}
              className="text-muted-foreground hover:text-destructive"
              aria-label={tShopping('ariaRemove', { name: item.name })}
            >
              <X className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tShopping('removeTooltip')}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
