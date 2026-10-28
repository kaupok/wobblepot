'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api'
import type { Locale } from '@/lib/i18n/locales'
import type { MealData, PreparationSteps } from '@/components/meal-plan/types'
import { useDebouncedValue } from './use-debounced-value'
import { isRetryableStepsError, stepsErrorMessage } from './steps-error'

/**
 * How long the serving count must stay put before its steps are asked for, so
 * three taps on + make one AI call, not three.
 */
export const RECIPE_STEPS_DEBOUNCE_MS = 500

/**
 * Keyed by the recipe's content as well as its servings: the steps follow
 * the name, the time, the notes and the ingredient amounts, so an edit saved
 * in this session must miss the cached steps rather than show the old ones
 * beside the new amounts. The route answers the new key from its own store,
 * or writes new steps.
 */
export const recipeStepsQueryKey = (mealId: string, servings: number, content: string) =>
  ['meal', mealId, 'steps', servings, content] as const

/** What the steps prompt reads from the recipe, as one string for the key. */
export function recipeStepsContent(
  meal: Pick<MealData, 'name' | 'timeMinutes' | 'preparationNotes' | 'components'>,
): string {
  return JSON.stringify([
    meal.name,
    meal.timeMinutes ?? null,
    meal.preparationNotes ?? null,
    meal.components.map((c) => [c.ingredientId, c.quantityPerServing]),
  ])
}

interface UseRecipeStepsOptions {
  meal: Pick<MealData, 'id' | 'name' | 'timeMinutes' | 'preparationNotes' | 'components'>
  /** The servings the view shows; steps are written for this count. */
  servings: number
  /** Whether the view is open. Nothing is fetched while closed. */
  enabled: boolean
}

/**
 * A recipe's steps in the recipe cook view (HON-1338), for the household's
 * own recipe or a library meal (HON-1351), from
 * `POST /api/meals/{id}/preparation-steps`. A query, keyed by the servings, so
 * a serving change asks again by itself and a count already seen this session
 * shows at once. The route stores the steps, so a later visit at the same count
 * costs no AI call either.
 */
export function useRecipeSteps({ meal, servings, enabled }: UseRecipeStepsOptions) {
  const mealId = meal.id
  const content = recipeStepsContent(meal)
  const t = useTranslations('meal-plan.steps')
  const locale = useLocale() as Locale
  const settledServings = useDebouncedValue(servings, RECIPE_STEPS_DEBOUNCE_MS)
  const settling = settledServings !== servings

  const query = useQuery({
    queryKey: recipeStepsQueryKey(mealId, settledServings, content),
    queryFn: ({ signal }) =>
      apiFetch<{ tips: PreparationSteps }>(
        `/api/meals/${mealId}/preparation-steps`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servings: settledServings }),
          signal,
        },
        t('errors.tipsFailed'),
      ).then((data) => data.tips),
    enabled: enabled && !settling,
    // A billed generation: never refetched behind the household's back.
    staleTime: Infinity,
    // Once, 2s later, as `useMealSteps` does, for the errors that clear.
    retry: (failureCount, error) => failureCount < 1 && isRetryableStepsError(error),
    retryDelay: 2000,
  })

  // Memoised by the error, so its console breadcrumb is logged once per
  // failure rather than on every render.
  const { error } = query
  const errorMessage = useMemo(
    () => (error ? stepsErrorMessage(error, t, locale, '[recipe-steps]') : null),
    [error, t, locale],
  )

  // Retry after a failure keeps the query in `error` while it asks again;
  // show the skeleton, not the old message, meanwhile.
  const waiting = settling || query.isPending || (query.isFetching && !query.data)

  return {
    // Steps for another count do not match the ingredient list, so none show
    // while a new count settles.
    steps: settling ? null : (query.data ?? null),
    isLoadingSteps: enabled && waiting,
    stepsError: waiting ? null : errorMessage,
    retry: () => void query.refetch(),
  }
}
