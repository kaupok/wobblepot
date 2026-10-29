'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body, Heading } from '@/components/ui/typography'
import type { MealType } from '@/generated/prisma/enums'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { ApiError, apiFetch } from '@/lib/api'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { FrequentMeal } from '@/lib/meal-plans/past-logging'

/** Recipes the library lists at once; a search reaches the rest. */
const LIBRARY_PAGE_SIZE = 20

interface LogMealPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  date: string
  mealType: MealType
  /** The day as its heading reads it, e.g. "Tuesday Apr 14". */
  dayLabel: string
  /** The meals the household cooked most in the last 30 days, most first. */
  frequentMeals: FrequentMeal[]
  /** The meal was saved. The caller refreshes the page. */
  onSaved: () => void
  /** Opened from state, so the caller returns focus to its opener (docs/DESIGN.md → Focus management). */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * The recipe picker for a log on Past meals (HON-1383): the household already
 * ate the meal, so a pick saves it as cooked in one request, with no
 * placeholder, no AI suggestions and no pantry change. The meals it cooked
 * most in the last 30 days come first, because its rotation is small; its own
 * recipes follow, and a search reaches the whole library.
 */
export function LogMealPicker({
  open,
  onOpenChange,
  onCloseAutoFocus,
  ...props
}: LogMealPickerProps) {
  const t = useTranslations('pastMeals.log')
  const mealTypeLabel = useEnumLabel('MealType', props.mealType)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', { day: props.dayLabel, mealType: mealTypeLabel })}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted with the content, so each open starts with an empty search. */}
        <PickerBody {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

type PickerBodyProps = Omit<LogMealPickerProps, 'open' | 'onOpenChange' | 'onCloseAutoFocus'> & {
  onClose: () => void
}

interface LibraryMeal {
  id: string
  name: string
}

function PickerBody({ planId, date, mealType, frequentMeals, onSaved, onClose }: PickerBodyProps) {
  const t = useTranslations('pastMeals.log')
  const tCard = useTranslations('meal-plan.card')
  const searchId = useId()
  const [query, setQuery] = useState('')
  const search = useDebouncedValue(query.trim())

  const libraryQuery = useQuery({
    // No `mealType`: the household already ate the meal, so a dinner recipe
    // eaten at lunch is logged as lunch. `createEntry` does not check the slot.
    queryKey: ['log-meal-picker', search],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(LIBRARY_PAGE_SIZE),
        offset: '0',
      })
      // With no search, the household's own recipes; a search reaches the library.
      if (search) params.set('search', search)
      else params.set('source', 'custom')
      return apiFetch<{ meals: LibraryMeal[] }>(`/api/meals?${params.toString()}`)
    },
  })

  const saveMutation = useMutation({
    mutationFn: (mealId: string) =>
      apiFetch(`/api/meal-plans/${planId}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, mealType, mealId, status: 'completed' }),
      }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error(
        '[log-meal-picker] save failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      // A 409: another tab or member filled the slot meanwhile.
      toast.error(
        err instanceof ApiError && err.status === 409
          ? tCard('entryAlreadyExists')
          : t('saveFailed'),
      )
    },
  })
  const isSaving = saveMutation.isPending

  function choose(mealId: string) {
    if (isSaving) return
    saveMutation.mutate(mealId)
  }

  const frequentIds = new Set(frequentMeals.map((meal) => meal.id))
  // A search lists every match; the default view leaves out what is listed above it.
  const libraryMeals = (libraryQuery.data?.meals ?? []).filter(
    (meal) => search || !frequentIds.has(meal.id),
  )

  return (
    <>
      {/* The 4px pad, pulled back by an equal margin, keeps the 3px focus ring
          of an edge control inside the box `overflow` clips (HON-1353). */}
      <div className="-m-1 flex max-h-96 flex-col gap-5 overflow-y-auto p-1">
        <section className="flex flex-col gap-2">
          <Label htmlFor={searchId}>{t('search')}</Label>
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
          />
        </section>

        {!search && frequentMeals.length > 0 && (
          <MealList
            heading={t('frequentHeading')}
            meals={frequentMeals}
            isSaving={isSaving}
            onChoose={choose}
          />
        )}

        {libraryQuery.isPending ? (
          <Body variant="muted">{t('loading')}</Body>
        ) : libraryQuery.isError ? (
          <Body variant="muted">{t('loadFailed')}</Body>
        ) : libraryMeals.length === 0 ? (
          search ? (
            <Body variant="muted">{t('noMatch', { query: search })}</Body>
          ) : (
            frequentMeals.length === 0 && <Body variant="muted">{t('noRecipes')}</Body>
          )
        ) : (
          <MealList
            heading={search ? t('resultsHeading') : t('myRecipesHeading')}
            meals={libraryMeals}
            isSaving={isSaving}
            onChoose={choose}
          />
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
      </DialogFooter>
    </>
  )
}

function MealList({
  heading,
  meals,
  isSaving,
  onChoose,
}: {
  heading: string
  meals: LibraryMeal[]
  isSaving: boolean
  onChoose: (mealId: string) => void
}) {
  const headingId = useId()
  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId}>
      <Heading variant="caption" as="h3" id={headingId}>
        {heading}
      </Heading>
      <ul className="flex flex-col gap-1">
        {meals.map((meal) => (
          <li key={meal.id}>
            {/* Not `disabled`: a disabled button drops focus (HON-803). */}
            <Button
              variant="outline"
              className="w-full max-w-full justify-start"
              aria-disabled={isSaving || undefined}
              onClick={() => onChoose(meal.id)}
            >
              <span className="truncate">{meal.name}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
