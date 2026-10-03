'use client'

import { Trash2, Unlink } from 'lucide-react'
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
        // 44px on touch (the `leading-7` name line plus `py-2`), 36px with a
        // mouse, where the hover wash shows the row under the pointer. The
        // pointer type, not the width: a touch tablet at `md` keeps 44px
        // (HON-1017, docs/DESIGN.md → Spacing, radius, elevation).
        'min-h-touch flex items-center justify-between gap-3 px-3 py-2 transition-colors pointer-fine:min-h-9 pointer-fine:py-1',
        // `accent`, not `muted`: the shopping note re-maps `--accent` to its
        // chip, so the wash stays yellow on the sheet (HON-1012).
        'hover:bg-accent/50',
        item.checked && 'bg-accent/30',
        disabled && 'pointer-events-none opacity-50',
        pending && !disabled && 'opacity-70',
      )}
    >
      <label className="flex flex-1 cursor-pointer items-center gap-3">
        <Checkbox
          checked={item.checked}
          onCheckedChange={handleCheckedChange}
          disabled={disabled}
          aria-label={tShopping('ariaToggleItem', {
            name: item.name,
            state: item.checked ? tShopping('stateNotPurchased') : tShopping('statePurchased'),
          })}
        />
        <div className="flex items-baseline gap-2">
          <Body
            tone={item.checked ? 'muted' : 'default'}
            className={cn('transition-colors', item.checked && 'line-through')}
          >
            {item.name}
          </Body>
          {item.ingredientCategory && (
            <CategoryBadge category={item.ingredientCategory as IngredientCategory} />
          )}
        </div>
      </label>
      {/* `-my-0.5` lets the 32px `icon-sm` actions reach 2px into the row's
          vertical padding instead of growing the row past the 28px name line,
          so the row is 44px on touch and 36px with a mouse, as `ShoppingItem`
          is — `ShoppingItemSkeleton.stories.tsx` holds both to it. */}
      <div className="-my-0.5 flex shrink-0 items-center gap-1">
        {item.ingredientId && !item.checked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="quiet"
                size="icon-sm"
                onClick={() => onUnlink(item.id)}
                aria-label={tShopping('ariaUnlink', { name: item.name })}
              >
                <Unlink className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tShopping('unlinkTooltip')}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="quiet-destructive"
              size="icon-sm"
              onClick={() => onDelete(item.id)}
              aria-label={tShopping('ariaRemove', { name: item.name })}
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tShopping('removeTooltip')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
