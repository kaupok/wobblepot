'use client'

import { useCallback } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { AlternativeMeal, MealComponent, NutritionData } from '../types'
import type { MealType, ProteinType } from '@/generated/prisma/enums'

/** Shape of a meal in the `/api/meals` response. */
interface LibraryMeal {
  id: string
  name: string
  description: string | null
  timeMinutes: number | null
  kidFriendly: boolean
  primaryProteinType: ProteinType
  suitableFor: MealType[]
  components: MealComponent[]
  nutrition: NutritionData
}

interface MealsSearchResponse {
  meals: LibraryMeal[]
  hasMore: boolean
  total: number
}

const PAGE_SIZE = 20

function toAlternativeMeal(meal: LibraryMeal): AlternativeMeal {
  return {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    timeMinutes: meal.timeMinutes,
    kidFriendly: meal.kidFriendly,
    primaryProteinType: meal.primaryProteinType,
    suitableFor: meal.suitableFor,
    reason: '',
    components: meal.components,
    nutrition: meal.nutrition,
  }
}

/**
 * Offset-based pagination: the next page starts where the accumulated results end.
 * Returning `undefined` tells React Query there is no further page.
 */
function nextOffset(lastPage: MealsSearchResponse, allPages: MealsSearchResponse[]) {
  if (!lastPage.hasMore) return undefined
  return allPages.reduce((count, page) => count + page.meals.length, 0)
}

export interface UseMealAlternativesOptions {
  /** Modal open state — every query is disabled while closed. */
  open: boolean
  planId: string
  entryId: string
  mealType: MealType
  /** 'swap' regenerates alternatives for the current meal; 'add' suggests for an empty slot. */
  mode: 'swap' | 'add'
  /** Debounced search term. Non-empty switches the modal into search mode. */
  search: string
  myRecipesOnly: boolean
}

export interface UseMealAlternativesResult {
  /** Meals to render, already flattened across loaded pages. */
  displayedMeals: AlternativeMeal[]
  isLoading: boolean
  /** True while a "load more" page is in flight. */
  isFetchingMore: boolean
  hasMore: boolean
  loadMore: () => void
  /** Total matches reported by the server for the active list, 0 for suggestions. */
  total: number
  /** True once a search/browse response has arrived — gates the "no results" copy. */
  hasLoadedList: boolean
  isSearchMode: boolean
  isMyRecipesBrowseMode: boolean
}

/**
 * The three meal lists behind `MealSelectorModal`: AI suggestions (default),
 * library search, and "my recipes" browse. Exactly one is active at a time,
 * chosen by `search` / `myRecipesOnly`.
 *
 * Search and browse paginate through `useInfiniteQuery`, so pages accumulate in
 * the query cache rather than in component state, and changing the search term
 * or filter resets pagination by changing the query key.
 */
export function useMealAlternatives({
  open,
  planId,
  entryId,
  mealType,
  mode,
  search,
  myRecipesOnly,
}: UseMealAlternativesOptions): UseMealAlternativesResult {
  const trimmedSearch = search.trim()
  const isSearchMode = trimmedSearch.length > 0
  const isMyRecipesBrowseMode = myRecipesOnly && !isSearchMode

  // AI suggestions — fetched once when the modal opens with no search active.
  const suggestionsEndpoint =
    mode === 'swap'
      ? `/api/meal-plans/${planId}/entries/${entryId}/regenerate`
      : `/api/meal-plans/${planId}/entries/${entryId}/suggestions`

  const { data: suggestions = [], isLoading: isLoadingSuggestions } = useQuery({
    queryKey: ['meal-suggestions', planId, entryId, mode],
    queryFn: async () => {
      const data = await apiFetch<{
        alternatives?: AlternativeMeal[]
        suggestions?: AlternativeMeal[]
      }>(suggestionsEndpoint, { method: 'POST' })
      return data.alternatives || data.suggestions || []
    },
    enabled: open && !isSearchMode && !isMyRecipesBrowseMode,
    staleTime: Infinity,
  })

  const searchQuery = useInfiniteQuery({
    queryKey: ['meal-search', trimmedSearch, mealType, myRecipesOnly],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      params.set('mealType', mealType)
      params.set('search', trimmedSearch)
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageParam))
      if (myRecipesOnly) params.set('source', 'custom')
      return apiFetch<MealsSearchResponse>(`/api/meals?${params.toString()}`)
    },
    getNextPageParam: nextOffset,
    enabled: open && isSearchMode,
  })

  const myRecipesQuery = useInfiniteQuery({
    queryKey: ['my-recipes', mealType],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      params.set('mealType', mealType)
      params.set('source', 'custom')
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageParam))
      return apiFetch<MealsSearchResponse>(`/api/meals?${params.toString()}`)
    },
    getNextPageParam: nextOffset,
    enabled: open && isMyRecipesBrowseMode,
  })

  const activeQuery = isMyRecipesBrowseMode ? myRecipesQuery : isSearchMode ? searchQuery : null

  const pages = activeQuery?.data?.pages
  const displayedMeals = activeQuery
    ? (pages?.flatMap((page) => page.meals.map(toAlternativeMeal)) ?? [])
    : suggestions

  const { fetchNextPage } = activeQuery ?? {}
  const loadMore = useCallback(() => {
    void fetchNextPage?.()
  }, [fetchNextPage])

  return {
    displayedMeals,
    isLoading: activeQuery ? activeQuery.isLoading : isLoadingSuggestions,
    isFetchingMore: activeQuery?.isFetchingNextPage ?? false,
    hasMore: activeQuery?.hasNextPage ?? false,
    loadMore,
    total: pages?.[0]?.total ?? 0,
    hasLoadedList: !!pages,
    isSearchMode,
    isMyRecipesBrowseMode,
  }
}
