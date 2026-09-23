import type { MealData } from '@/components/household/MealList'

export type MealsPage = { meals: MealData[]; nextCursor: string | null }

/**
 * Key, first page param and next-page param shared by the `/recipes` server
 * prefetch and `RecipesPageClient` (HON-770). They must match exactly, or the
 * client ignores the hydrated page and fetches the list again on mount.
 */
export function mealsQueryKey(search: string | undefined) {
  return ['meals', { search }] as const
}

export const mealsInitialPageParam: string | null = null

export function getNextMealsPageParam(lastPage: MealsPage) {
  return lastPage.nextCursor
}
