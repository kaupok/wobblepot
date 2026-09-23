'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Sparkles } from 'lucide-react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Heading, Body } from '@/components/ui/typography'
import { MealList, type MealData } from '@/components/household/MealList'
import { apiFetch } from '@/lib/api'
import { RecipesGridSkeleton } from './RecipesGridSkeleton'
import {
  getNextMealsPageParam,
  mealsInitialPageParam,
  mealsQueryKey,
  type MealsPage,
} from './meals-query'

export function RecipesPageClient() {
  const queryClient = useQueryClient()
  const tRecipes = useTranslations('recipes')
  const tLibrary = useTranslations('recipes.library')

  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(id)
  }, [searchQuery])

  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useInfiniteQuery<MealsPage>({
    // Same key and page params as the server prefetch in `page.tsx`, so the
    // hydrated first page is adopted rather than refetched (HON-770).
    queryKey: mealsQueryKey(debouncedSearch || undefined),
    initialPageParam: mealsInitialPageParam,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('cursor', pageParam as string)
      if (debouncedSearch) params.set('search', debouncedSearch)
      const qs = params.toString() ? `?${params}` : ''
      return apiFetch<MealsPage>(`/api/households/me/meals${qs}`)
    },
    getNextPageParam: getNextMealsPageParam,
  })

  const meals = data?.pages.flatMap((page) => page.meals) ?? []

  useEffect(() => {
    if (error) toast.error(tLibrary('loadFailed'))
  }, [error, tLibrary])

  useEffect(() => {
    if (isFetchNextPageError) toast.error(tLibrary('loadMoreFailed'))
  }, [isFetchNextPageError, tLibrary])

  const updatePages = (mapper: (meal: MealData) => MealData | null) => {
    queryClient.setQueriesData<InfiniteData<MealsPage>>({ queryKey: ['meals'] }, (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          meals: page.meals
            .map((meal) => mapper(meal))
            .filter((meal): meal is MealData => meal !== null),
        })),
      }
    })
  }

  const handleDelete = (mealId: string) => {
    updatePages((meal) => (meal.id === mealId ? null : meal))
  }

  const handleToggleFavorite = (mealId: string, isFavorite: boolean) => {
    updatePages((meal) => (meal.id === mealId ? { ...meal, isFavorite } : meal))
  }

  const isSearchEmpty = debouncedSearch !== '' && !isLoading && !error && meals.length === 0

  return (
    // A list page: container shell, title on the background, top-aligned, no
    // page-level Card — the meal cards are the only cards (HON-767, HON-747).
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <Heading variant="h4" as="h1">
          {tLibrary('title')}
        </Heading>
        <Body variant="muted">{tLibrary('description')}</Body>
      </div>

      <Input
        type="search"
        placeholder={tLibrary('searchPlaceholder')}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        aria-label={tLibrary('searchAria')}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Body variant="muted">
          {isLoading
            ? tLibrary('loading')
            : hasNextPage
              ? tRecipes('mealCountMore', { count: meals.length })
              : tRecipes('mealCount', { count: meals.length })}
        </Body>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/recipes/imagine">
              <Sparkles className="mr-2 h-4 w-4" />
              {tLibrary('imagineButton')}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/recipes/import">
              <Plus className="mr-2 h-4 w-4" />
              {tLibrary('addButton')}
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        // After the server prefetch this only shows while a new search loads;
        // it draws the same grid as `loading.tsx`, so nothing jumps (HON-770).
        <RecipesGridSkeleton />
      ) : isSearchEmpty ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Body variant="muted">{tLibrary('emptySearch', { query: debouncedSearch })}</Body>
        </div>
      ) : (
        <>
          <MealList meals={meals} onDelete={handleDelete} onToggleFavorite={handleToggleFavorite} />
          {hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? tLibrary('loadingMore') : tLibrary('loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
