'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Body } from '@/components/ui/typography'
import { IngredientSearch } from '@/components/household/IngredientSearch'
import type { IngredientResult } from '@/hooks/use-ingredient-search'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { MAX_QUANTITY_PER_SERVING } from '@/lib/meal-planning/components-schema'
import type { MealComponent } from './types'

interface IngredientChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The row to replace; null to add an ingredient. */
  original: MealComponent | null
  /** The entry's effective servings: the amount is entered for all of them. */
  servings: number
  /** Ingredients already in the meal, which the search marks as added. */
  existingIngredientIds: string[]
  isSubmitting: boolean
  /** Resolves true once stored; the dialog then closes. */
  onSubmit: (replacement: IngredientResult, quantityPerServing: number) => Promise<boolean>
  /**
   * Opened from a menu item, so Radix has no trigger to return focus to
   * (docs/DESIGN.md → Focus management): the caller focuses the row's control.
   */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * The amount to prefill: the original's, for the entry's servings, but only
 * when both ingredients are counted the same way. Eggs in pieces against flour
 * in grams would prefill a number that is wrong, and it reaches the shopping
 * list, so the field stays empty and required instead (HON-1243).
 */
function prefill(
  original: MealComponent | null,
  replacement: IngredientResult,
  servings: number,
): number | null {
  if (!original || original.isVague) return null
  if (original.ingredient.defaultUnit !== replacement.defaultUnit) return null
  return Math.round(original.quantityPerServing * servings * 10) / 10
}

/**
 * Replace one ingredient of a planned entry, or add one (HON-1243): pick it in
 * the ingredient search, then enter the amount for the entry's servings. The
 * amount is stored per serving, in the ingredient's own unit.
 */
export function IngredientChangeDialog({
  open,
  onOpenChange,
  original,
  servings,
  existingIngredientIds,
  isSubmitting,
  onSubmit,
  onCloseAutoFocus,
}: IngredientChangeDialogProps) {
  const t = useTranslations('meal-plan.changes.dialog')
  const tCommon = useTranslations('common')
  const pieceLabel = useEnumLabel('Unit', 'piece')
  const quantityId = useId()
  const [picked, setPicked] = useState<IngredientResult | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  // The submit button is disabled while the change is stored; after a refusal
  // the dialog stays open, so focus goes back to it (docs/DESIGN.md → Focus).
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isSubmitting)

  // A reopened dialog starts from the search.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setPicked(null)
      setQuantity(null)
    }
  }

  const pick = (ingredient: IngredientResult) => {
    setPicked(ingredient)
    setQuantity(prefill(original, ingredient, servings))
  }

  const total = quantity ?? 0
  const perServing = total / servings
  const valid = picked !== null && total > 0 && perServing <= MAX_QUANTITY_PER_SERVING
  const unitDiffers =
    !!picked && !!original && original.ingredient.defaultUnit !== picked.defaultUnit
  const unit = picked ? displayUnit(picked) : null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || isSubmitting) return
    if (await onSubmit(picked, perServing)) onOpenChange(false)
    else requestRefocus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>
            {original ? t('replaceTitle', { name: original.ingredient.name }) : t('addTitle')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {picked ? (
          <form id={`${quantityId}-form`} onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <Body variant="paragraph">{picked.name}</Body>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPicked(null)}
                disabled={isSubmitting}
              >
                {t('pickAnother')}
              </Button>
            </div>
            <Label htmlFor={quantityId}>{t('quantityLabel', { count: servings })}</Label>
            <div className="focus-within:border-ring focus-within:ring-ring/50 border-input flex w-fit items-center rounded-md border focus-within:ring-3">
              <NumberInput
                id={quantityId}
                value={quantity}
                onValueChange={setQuantity}
                embedded
                className="w-24"
                required
                autoFocus
                disabled={isSubmitting}
              />
              <span className="text-foreground bg-muted border-l px-2 py-1.5 text-sm">
                {unit === 'piece' ? pieceLabel : unit}
              </span>
            </div>
            {unitDiffers && <Body variant="muted">{t('unitsDiffer')}</Body>}
          </form>
        ) : (
          <IngredientSearch
            disabled={isSubmitting}
            existingIngredientIds={existingIngredientIds}
            onAddIngredient={pick}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {tCommon('cancel')}
          </Button>
          <Button
            ref={submitRef}
            type="submit"
            form={`${quantityId}-form`}
            disabled={!valid || isSubmitting}
          >
            {original ? t('submitReplace') : t('submitAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
