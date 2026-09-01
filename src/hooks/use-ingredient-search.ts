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
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
}

const DEBOUNCE_MS = 300

/**
 * Debounced ingredient catalog search shared by the meal form, the recipe
 * import rows, and the pantry quick-add.
 *
 * The query is disabled for an empty search, so `data` is `undefined` (and the
 * caller's `= []` default applies) until the user types something. Clearing the
 * field skips the debounce so the dropdown collapses immediately.
 */
export function useIngredientSearch(query: string) {
  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS)
  const search = trimmed === '' ? '' : debounced

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
