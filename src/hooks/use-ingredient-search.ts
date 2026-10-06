'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useDebouncedValue } from './use-debounced-value'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

/**
 * A single ingredient row as returned by `GET /api/ingredients`. This is the
 * one definition in the repo — `@/components/household/meal-form-types` and
 * `@/components/recipes/IngredientRow` re-export it for their own callers.
 */
export interface IngredientResult {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  gramsPerPiece?: number | null
  /** Shown in millilitres, 1 g = 1 ml (HON-1054). Absent reads as grams. */
  measuredByVolume?: boolean
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  /**
   * The other English name the search term matched ("plain flour" for
   * all-purpose flour), shown in brackets in the dropdown (HON-1100). Absent on
   * a row found by its own name.
   */
  matchedAs?: string
}

/**
 * The picked row without its search-only `matchedAs`, so every screen after
 * the dropdown shows the pool name only and the field never reaches form state
 * or a request body.
 */
export function withoutMatchedAs({
  matchedAs: _matchedAs,
  ...ingredient
}: IngredientResult): IngredientResult {
  return ingredient
}

const DEBOUNCE_MS = 300

/**
 * Debounced ingredient catalog search shared by the meal form, the recipe
 * import rows, and the pantry quick-add.
 *
 * The query is disabled until the debounced term catches up with what the user
 * is typing, so `data` is `undefined` (and the caller's `= []` default applies)
 * for an empty field, and results are dropped immediately when the term stops
 * being an extension of the one they were fetched for.
 */
export function useIngredientSearch(query: string) {
  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS)
  // Only trust the debounced term while the user is still extending it. After a
  // selection clears the field — or the user starts an unrelated query — the
  // debounced value is stale for up to one window, and reusing it would reopen
  // the previous query's cached dropdown underneath the new input.
  const search = trimmed !== '' && trimmed.startsWith(debounced) ? debounced : ''

  return useQuery({
    queryKey: ['ingredients', { search }],
    queryFn: () =>
      apiFetch<{ ingredients: IngredientResult[] }>(
        `/api/ingredients?search=${encodeURIComponent(search)}`,
      ),
    enabled: search.length > 0,
    select: (data) => data.ingredients,
  })
}
