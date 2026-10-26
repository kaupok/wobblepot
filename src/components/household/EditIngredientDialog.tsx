'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
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
import { FieldError } from '@/components/FieldError'
import { IngredientFields, useIngredientDraft } from '@/components/recipes/IngredientFields'
import { apiFetch, ApiError } from '@/lib/api'
import type { HouseholdIngredient } from '@/lib/ingredients/household-ingredient'
import type { NewIngredientInput } from '@/lib/ingredients/new-ingredient'
import { invalidateHouseholdIngredients } from './household-ingredients-query'

interface EditIngredientDialogProps {
  /** The row to edit. Kept while the dialog closes, so its content stays through the animation. */
  ingredient: HouseholdIngredient | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opened from state with no trigger: where focus goes when it closes. */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * Edit on the Ingredients tab (HON-1264): the fields of "Add as new
 * ingredient", filled from the row. A recipe that uses the row keeps its id,
 * so the change applies to it at once.
 */
export function EditIngredientDialog({
  ingredient,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: EditIngredientDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-dialog overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {/* Radix unmounts the content once closed, so the fields start from
            the row each time it opens. */}
        {ingredient && (
          <EditIngredientForm ingredient={ingredient} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditIngredientForm({
  ingredient,
  onDone,
}: {
  ingredient: HouseholdIngredient
  onDone: () => void
}) {
  const t = useTranslations('household.ingredients')
  const tFields = useTranslations('recipes.addIngredient')
  const tCommon = useTranslations('common')
  const queryClient = useQueryClient()
  const draft = useIngredientDraft(ingredient)
  const [formError, setFormError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (input: NewIngredientInput) =>
      apiFetch<{ ingredient: HouseholdIngredient }>(`/api/ingredients/${ingredient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateHouseholdIngredients(queryClient)
      onDone()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'name_taken') {
        draft.markName(t('errors.nameTaken'))
      } else if (error instanceof ApiError && error.code === 'unit_locked') {
        setFormError(t('errors.unitLocked'))
      } else if (error instanceof ApiError && error.status === 429) {
        setFormError(t('errors.rateLimited'))
      } else if (error instanceof ApiError && error.status === 400) {
        setFormError(draft.markServerErrors(error.body) ? null : tFields('errors.generic'))
      } else {
        // The route's `error` is English, for logs; the dialog renders catalog copy.
        console.error('[EditIngredientDialog] Save failed:', error.message)
        setFormError(tFields('errors.generic'))
      }
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // `aria-disabled`, not `disabled`, so focus stays on Save while it runs;
    // this guard is what stops a second tap (docs/DESIGN.md → Focus management).
    if (save.isPending) return
    setFormError(null)
    const input = draft.validate()
    if (input) save.mutate(input)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t('editTitle', { name: ingredient.name })}</DialogTitle>
        <DialogDescription>{t('editDescription')}</DialogDescription>
      </DialogHeader>

      <IngredientFields draft={draft} />

      {formError && <FieldError>{formError}</FieldError>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" aria-disabled={save.isPending || undefined}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {tCommon('save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
