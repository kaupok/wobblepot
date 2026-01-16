'use client'

import { useState } from 'react'
import { Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

export interface PantryItemData {
  id: string
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
  }
  quantity: number | null
  isStaple: boolean
  updatedAt: string
  /** Raw needed quantity in grams (only present when window data is available) */
  neededQuantity?: number
  /** Formatted display quantity like "450g" or "3" (only present when window data is available) */
  neededDisplayQuantity?: string
  /** Number of days in the shopping window (7 or 14) */
  windowDays?: number
}

interface PantryItemProps {
  item: PantryItemData
  onToggleStaple: (id: string, currentIsStaple: boolean) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

export function PantryItem({ item, onToggleStaple, onRemove }: PantryItemProps) {
  const [isToggling, setIsToggling] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)

  const handleToggle = async () => {
    setIsToggling(true)
    try {
      await onToggleStaple(item.id, item.isStaple)
    } finally {
      setIsToggling(false)
    }
  }

  const handleRemove = async () => {
    setIsRemoving(true)
    try {
      await onRemove(item.id)
      setShowRemoveDialog(false)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleToggle}
          disabled={isToggling}
          className="h-8 w-8"
          aria-label={item.isStaple ? 'Remove from staples' : 'Mark as staple'}
        >
          <Star
            className={cn(
              'h-4 w-4',
              item.isStaple
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-muted-foreground hover:text-yellow-400',
            )}
          />
        </Button>
        <Body>{item.ingredient.name}</Body>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setShowRemoveDialog(true)}
        className="text-muted-foreground hover:text-destructive h-8 w-8"
        aria-label={`Remove ${item.ingredient.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <ConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        title="Remove from pantry"
        description={`Are you sure you want to remove ${item.ingredient.name} from your pantry?`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleRemove}
        isLoading={isRemoving}
      />
    </div>
  )
}
