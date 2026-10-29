'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

import type { FridgeMealItem } from '../types'
import { useFridgeItemText } from './use-fridge-item-text'

interface FridgeCompleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The fridge meal's items. Only the pantry ones are listed. */
  items: FridgeMealItem[]
  /** Completes the meal; the ids are the ingredients ticked "Used it all". */
  onConfirm: (usedUpIngredientIds: string[]) => void
  isLoading?: boolean
  /** Opened from state, so the caller returns focus to its opener (docs/DESIGN.md → Focus management). */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * Completing a fridge meal (HON-1277): one "Used it all" tick per pantry item,
 * none ticked at first. A ticked item is set to "ran out" in the pantry, and an
 * unticked one keeps its quantity, because a fridge meal has no amounts to
 * subtract.
 */
export function FridgeCompleteDialog({
  open,
  onOpenChange,
  items,
  onConfirm,
  isLoading = false,
  onCloseAutoFocus,
}: FridgeCompleteDialogProps) {
  const t = useTranslations('meal-plan.fridge')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('completeTitle')}</DialogTitle>
          <DialogDescription>{t('completeDescription')}</DialogDescription>
        </DialogHeader>
        {/* Mounted with the content, so each open starts with nothing ticked. */}
        <CompleteForm
          items={items}
          onConfirm={onConfirm}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  )
}

function CompleteForm({
  items,
  onConfirm,
  onCancel,
  isLoading,
}: {
  items: FridgeMealItem[]
  onConfirm: (ids: string[]) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const t = useTranslations('meal-plan.fridge')
  const itemText = useFridgeItemText()
  const idPrefix = useId()
  const [usedUp, setUsedUp] = useState<ReadonlySet<string>>(new Set())
  const pantryItems = items.filter(
    (item): item is FridgeMealItem & { ingredientId: string } => item.ingredientId !== null,
  )

  function toggle(ingredientId: string, checked: boolean) {
    setUsedUp((current) => {
      const next = new Set(current)
      if (checked) next.add(ingredientId)
      else next.delete(ingredientId)
      return next
    })
  }

  function confirm() {
    if (isLoading) return
    onConfirm(pantryItems.flatMap((i) => (usedUp.has(i.ingredientId) ? [i.ingredientId] : [])))
  }

  return (
    <>
      <ul className="flex max-h-60 flex-col overflow-y-auto">
        {pantryItems.map((item) => {
          const id = `${idPrefix}-${item.ingredientId}`
          const name = itemText(item)
          return (
            // One label fills the row, so a tap anywhere on it toggles the
            // tick; the 20px checkbox keeps its own size. `min-h-touch` is the
            // 44px tap-target floor.
            <li key={item.id} className="min-h-touch flex">
              <Label htmlFor={id} className="flex-1 justify-between">
                <span className="min-w-0">{name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={usedUp.has(item.ingredientId)}
                    onCheckedChange={(checked) => toggle(item.ingredientId, checked === true)}
                    aria-label={t('usedItAllLabel', { name })}
                  />
                  {t('usedItAll')}
                </span>
              </Label>
            </li>
          )
        })}
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        {/* Not `disabled`: a disabled button drops focus (HON-803). */}
        <Button onClick={confirm} aria-disabled={isLoading || undefined}>
          {isLoading ? t('completing') : t('completeConfirm')}
        </Button>
      </DialogFooter>
    </>
  )
}
