'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { FieldError } from '@/components/FieldError'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import type { IngredientResult } from '@/hooks/use-ingredient-search'
import { ApiError, apiFetch } from '@/lib/api'
import type { NewIngredientInput } from '@/lib/ingredients/new-ingredient'

import { IngredientFields, useIngredientDraft } from './IngredientFields'

interface AddIngredientFormProps {
  /** The name the recipe used, prefilled. */
  extractedName: string
  /** Called with the saved ingredient: a new household row, or the one the name already meant. */
  onCreated: (ingredient: IngredientResult) => void
  onCancel: () => void
}

/**
 * "Add as new ingredient" from an unmatched ingredient row (HON-1263). The
 * household enters what the pack label says, per 100 g, and ticks the
 * allergens: the planner's allergen filter trusts them, and nothing else
 * checks them. Not a `<form>`, because the meal form around it is one.
 */
export function AddIngredientForm({ extractedName, onCreated, onCancel }: AddIngredientFormProps) {
  const t = useTranslations('recipes.addIngredient')
  const queryClient = useQueryClient()
  const draft = useIngredientDraft({ name: extractedName })
  const { nameRef } = draft
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [nameRef])

  const create = useMutation({
    mutationFn: (input: NewIngredientInput) =>
      apiFetch<{ ingredient: IngredientResult }>('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: ({ ingredient }) => {
      void queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      onCreated(ingredient)
    },
    onError: (error) => {
      // The route's `error` is English, for logs; the form renders catalog copy.
      console.error('[AddIngredientForm] Save failed:', error.message)
      if (error instanceof ApiError && error.status === 429) {
        setFormError(t('errors.rateLimited'))
      } else if (error instanceof ApiError && error.status === 400) {
        setFormError(draft.markServerErrors(error.body) ? null : t('errors.generic'))
      } else {
        setFormError(t('errors.generic'))
      }
    },
  })

  const handleSave = () => {
    // `aria-disabled`, not `disabled`, so focus stays on Save while it runs;
    // this guard is what stops a second tap (docs/DESIGN.md → Focus management).
    if (create.isPending) return
    setFormError(null)
    const input = draft.validate()
    if (input) create.mutate(input)
  }

  // The meal form around this is a `<form>`: Enter in a field saves the
  // ingredient here rather than submitting the meal.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault()
      handleSave()
    }
  }

  const titleId = `${draft.id}-title`

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-4"
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-col gap-1">
        <Body id={titleId} variant="small">
          {t('title')}
        </Body>
        <Body variant="muted">{t('hint')}</Body>
      </div>

      <IngredientFields draft={draft} />

      {formError && <FieldError>{formError}</FieldError>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleSave} aria-disabled={create.isPending || undefined}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  )
}
