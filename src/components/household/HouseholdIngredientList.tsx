'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { FieldError } from '@/components/FieldError'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Body, Heading } from '@/components/ui/typography'
import { apiFetch } from '@/lib/api'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { HouseholdIngredient } from '@/lib/ingredients/household-ingredient'

import { DeleteIngredientDialog } from './DeleteIngredientDialog'
import { EditIngredientDialog } from './EditIngredientDialog'
import {
  HOUSEHOLD_INGREDIENTS_QUERY_KEY,
  type HouseholdIngredientsResponse,
} from './household-ingredients-query'

/** A row's height: a name line, a details line and the buttons' 44px touch floor. */
export function IngredientRowSkeleton() {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-2">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-touch w-40 md:h-10" />
    </div>
  )
}

/** The category, then the allergens: "Vegetable · Contains: gluten, eggs". */
function IngredientDetails({ ingredient }: { ingredient: HouseholdIngredient }) {
  const t = useTranslations('household.ingredients')
  const tAllergen = useTranslations('enums.Allergen')
  const category = useEnumLabel('IngredientCategory', ingredient.category)
  if (ingredient.allergens.length === 0) return <>{category}</>
  const allergens = ingredient.allergens.map((allergen) => tAllergen(allergen)).join(', ')
  return <>{t('details', { category, allergens })}</>
}

/**
 * Household → Ingredients (HON-1264): the ingredients the household added
 * from a recipe, each with Edit and Delete. Both dialogs open from state, so
 * each hands focus back to the row's button, or to the heading once the row
 * is gone.
 */
export function HouseholdIngredientList() {
  const t = useTranslations('household.ingredients')
  // The row stays set while its dialog closes, so the dialog keeps its
  // content through the animation.
  const [dialog, setDialog] = useState<{
    kind: 'edit' | 'delete'
    ingredient: HouseholdIngredient
    open: boolean
  } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)

  const {
    data: ingredients = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: HOUSEHOLD_INGREDIENTS_QUERY_KEY,
    queryFn: () => apiFetch<HouseholdIngredientsResponse>('/api/households/me/ingredients'),
    select: (data) => data.ingredients,
  })

  const returnFocusOnClose = (event: Event) => {
    event.preventDefault()
    const button = returnFocusRef.current
    if (button?.isConnected) button.focus()
    else headingRef.current?.focus()
  }

  const openDialog =
    (kind: 'edit' | 'delete', ingredient: HouseholdIngredient) =>
    (e: React.MouseEvent<HTMLButtonElement>) => {
      returnFocusRef.current = e.currentTarget
      setDialog({ kind, ingredient, open: true })
    }
  const closeDialog = (isOpen: boolean) => {
    if (!isOpen) setDialog((current) => current && { ...current, open: false })
  }

  return (
    <>
      <section className="flex flex-col gap-4">
        <Heading ref={headingRef} tabIndex={-1} variant="section" as="h2">
          {t('heading')}
        </Heading>

        {isLoading ? (
          <div className="flex flex-col divide-y">
            <IngredientRowSkeleton />
            <IngredientRowSkeleton />
          </div>
        ) : error ? (
          <FieldError>{t('loadFailed')}</FieldError>
        ) : ingredients.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Body variant="muted">{t('empty')}</Body>
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {ingredients.map((ingredient) => (
              <li
                key={ingredient.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <Body>{ingredient.name}</Body>
                  <Body variant="muted">
                    <IngredientDetails ingredient={ingredient} />
                  </Body>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    aria-label={t('editNamed', { name: ingredient.name })}
                    onClick={openDialog('edit', ingredient)}
                  >
                    {t('edit')}
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={t('deleteNamed', { name: ingredient.name })}
                    onClick={openDialog('delete', ingredient)}
                  >
                    {t('delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EditIngredientDialog
        ingredient={dialog?.kind === 'edit' ? dialog.ingredient : null}
        open={dialog?.kind === 'edit' && dialog.open}
        onOpenChange={closeDialog}
        onCloseAutoFocus={returnFocusOnClose}
      />
      <DeleteIngredientDialog
        ingredient={dialog?.kind === 'delete' ? dialog.ingredient : null}
        open={dialog?.kind === 'delete' && dialog.open}
        onOpenChange={closeDialog}
        onCloseAutoFocus={returnFocusOnClose}
      />
    </>
  )
}
