import type { QueryClient } from '@tanstack/react-query'
import type { HouseholdIngredient } from '@/lib/ingredients/household-ingredient'

export type HouseholdIngredientsResponse = { ingredients: HouseholdIngredient[] }

/**
 * Key shared by the `/household/ingredients` server prefetch and
 * `HouseholdIngredientList` (HON-1264). Outside the `'use client'` module for
 * the reason `members-query.ts` gives.
 */
export const HOUSEHOLD_INGREDIENTS_QUERY_KEY = ['household-ingredients'] as const

/**
 * After an edit or a delete: the tab's list, and every ingredient search, so a
 * recipe form shows the new name and no deleted row.
 */
export function invalidateHouseholdIngredients(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: HOUSEHOLD_INGREDIENTS_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: ['ingredients'] })
}
