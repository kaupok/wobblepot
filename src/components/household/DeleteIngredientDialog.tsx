'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { apiFetch, ApiError } from '@/lib/api'
import type { HouseholdIngredient, IngredientUses } from '@/lib/ingredients/household-ingredient'
import {
  HOUSEHOLD_INGREDIENTS_QUERY_KEY,
  invalidateHouseholdIngredients,
  type HouseholdIngredientsResponse,
} from './household-ingredients-query'

interface DeleteIngredientDialogProps {
  /** The row to delete. Kept while the dialog closes, so its title stays through the animation. */
  ingredient: HouseholdIngredient | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opened from state with no trigger: where focus goes when it closes. */
  onCloseAutoFocus?: (event: Event) => void
}

const USE_KEYS = [
  'meals',
  'deletedMealsInPlan',
  'pantry',
  'shoppingList',
  'mealPlan',
  'extras',
] as const

/**
 * Delete on the Ingredients tab (HON-1264). The route refuses a row that
 * anything still uses; the dialog then names each use with its count, in
 * catalog copy, never the server's string.
 */
export function DeleteIngredientDialog({
  ingredient,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: DeleteIngredientDialogProps) {
  const t = useTranslations('household.ingredients')
  const queryClient = useQueryClient()
  const [uses, setUses] = useState<IngredientUses | null>(null)
  const [failed, setFailed] = useState(false)

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/ingredients/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      // The row leaves the list before the dialog closes, so its close hands
      // focus to the heading, not to a Delete button the refetch then removes.
      queryClient.setQueryData<HouseholdIngredientsResponse>(
        HOUSEHOLD_INGREDIENTS_QUERY_KEY,
        (current) => current && { ingredients: current.ingredients.filter((row) => row.id !== id) },
      )
      invalidateHouseholdIngredients(queryClient)
      onOpenChange(false)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'in_use') {
        setUses((error.body as { uses: IngredientUses }).uses)
      } else {
        // The route's `error` is English, for logs; the dialog renders catalog copy.
        console.error('[DeleteIngredientDialog] Delete failed:', error.message)
        setFailed(true)
      }
    },
  })

  const describe = () => {
    if (!ingredient) return ''
    if (uses) {
      const list = USE_KEYS.filter((key) => uses[key] > 0)
        .map((key) => t(`uses.${key}`, { count: uses[key] }))
        .join(', ')
      return t('inUse', { name: ingredient.name, uses: list })
    }
    if (failed) return t('deleteFailed')
    return t('deleteDescription')
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(open) => {
        // The request cannot be cancelled, so the dialog stays until it settles.
        if (open || remove.isPending) return
        setUses(null)
        setFailed(false)
        onOpenChange(false)
      }}
      title={ingredient ? t('deleteTitle', { name: ingredient.name }) : ''}
      description={describe()}
      confirmLabel={t('delete')}
      loadingLabel={t('deleting')}
      variant="destructive"
      isLoading={remove.isPending}
      onConfirm={() => {
        if (!ingredient) return
        setUses(null)
        setFailed(false)
        remove.mutate(ingredient.id)
      }}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
