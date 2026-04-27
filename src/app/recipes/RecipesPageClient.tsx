'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Loader2, Sparkles } from 'lucide-react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Heading, Body } from '@/components/ui/typography'
import { MealList, type MealData } from '@/components/household/MealList'
import { apiFetch } from '@/lib/api'

type MealsPage = { meals: MealData[]; nextCursor: string | null }

export function RecipesPageClient() {
  const queryClient = useQueryClient()
  const tRecipes = useTranslations('recipes')

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
    queryKey: ['meals', { search: debouncedSearch || undefined }],
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('cursor', pageParam as string)
      if (debouncedSearch) params.set('search', debouncedSearch)
      const qs = params.toString() ? `?${params}` : ''
      return apiFetch<MealsPage>(`/api/households/me/meals${qs}`)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const meals = data?.pages.flatMap((page) => page.meals) ?? []

  useEffect(() => {
    if (error) toast.error('Failed to load meals')
  }, [error])

  useEffect(() => {
    if (isFetchNextPageError) toast.error('Failed to load more meals')
  }, [isFetchNextPageError])

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
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <Heading variant="h4">My recipes</Heading>
          <Body variant="muted">Create and manage your household&apos;s custom recipes</Body>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6">
            <Input
              type="search"
              placeholder="Search recipes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search recipes"
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Body variant="muted">
                {isLoading
                  ? 'Loading...'
                  : hasNextPage
                    ? tRecipes('mealCountMore', { count: meals.length })
                    : tRecipes('mealCount', { count: meals.length })}
              </Body>
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link href="/recipes/imagine">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Imagine a meal
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/recipes/import">
                    <Plus className="mr-2 h-4 w-4" />
                    Add recipe
                  </Link>
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : isSearchEmpty ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Body variant="muted">
                  No recipes found matching &ldquo;{debouncedSearch}&rdquo;
                </Body>
              </div>
            ) : (
              <>
                <MealList
                  meals={meals}
                  onDelete={handleDelete}
                  onToggleFavorite={handleToggleFavorite}
                />
                {hasNextPage ? (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                    >
                      {isFetchingNextPage ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Load more'
                      )}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
