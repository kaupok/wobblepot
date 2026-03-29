'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Body } from '@/components/ui/typography'
import { AlternativeCard } from './AlternativeCard'
import { apiFetch } from '@/lib/api'
import type { AlternativeMeal, MealComponent, NutritionData, PantryIngredient } from './types'
import type { MealType, ProteinType } from '@/generated/prisma/enums'

interface MealSelectorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  entryId: string
  mealType: MealType
  householdSize: number
  currentMealName?: string
  onSwapComplete: () => void
  /** 'swap' = replacing existing meal (suggestions based on current meal), 'add' = empty slot (suggestions based on slot context) */
  mode: 'swap' | 'add'
  /** When provided, ingredient lists on cards are color-coded by pantry availability */
  pantryIngredients?: PantryIngredient[]
}

// Type for the /api/meals response
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

function AlternativeSkeleton() {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="ml-4 h-3 w-20" />
          <Skeleton className="ml-4 h-3 w-24" />
          <Skeleton className="ml-4 h-3 w-16" />
          <Skeleton className="ml-4 h-3 w-22" />
        </div>
        <Skeleton className="mt-auto h-9 w-full" />
      </CardContent>
    </Card>
  )
}

export function MealSelectorModal({
  open,
  onOpenChange,
  planId,
  entryId,
  mealType,
  householdSize,
  currentMealName,
  onSwapComplete,
  mode,
  pantryIngredients,
}: MealSelectorModalProps) {
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Filter state
  const [myRecipesOnly, setMyRecipesOnly] = useState(false)

  // Shared state
  const [error, setError] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)

  // Pagination state
  const [searchOffset, setSearchOffset] = useState(0)
  const [myRecipesOffset, setMyRecipesOffset] = useState(0)
  const [accumulatedSearch, setAccumulatedSearch] = useState<AlternativeMeal[]>([])
  const [accumulatedMyRecipes, setAccumulatedMyRecipes] = useState<AlternativeMeal[]>([])

  // Determine display mode
  const isSearchMode = debouncedSearch.trim().length > 0
  const isMyRecipesBrowseMode = myRecipesOnly && !isSearchMode

  // Debounce search input
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setSearchOffset(0)
      setAccumulatedSearch([])
    }, 300)
    return () => clearTimeout(id)
  }, [searchQuery, open])

  // Transform API meal to AlternativeMeal format
  const toAlternativeMeal = useCallback(
    (meal: LibraryMeal): AlternativeMeal => ({
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
    }),
    [],
  )

  // Reset state when modal closes via the Dialog callback
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSearchQuery('')
        setDebouncedSearch('')
        setMyRecipesOnly(false)
        setError(null)
        setSelectingId(null)
        setSearchOffset(0)
        setMyRecipesOffset(0)
        setAccumulatedSearch([])
        setAccumulatedMyRecipes([])
      }
      onOpenChange(newOpen)
    },
    [onOpenChange],
  )

  function handleMyRecipesToggle(checked: boolean) {
    setMyRecipesOnly(checked)
    setMyRecipesOffset(0)
    setAccumulatedMyRecipes([])
  }

  // Query 1: AI suggestions (fetched when modal opens)
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
    staleTime: 0,
  })

  // Query 2: Search results
  const { data: searchData, isLoading: isSearching } = useQuery({
    queryKey: ['meal-search', debouncedSearch, mealType, myRecipesOnly, searchOffset],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('mealType', mealType)
      params.set('search', debouncedSearch.trim())
      params.set('limit', '20')
      params.set('offset', String(searchOffset))
      if (myRecipesOnly) params.set('source', 'custom')
      return apiFetch<MealsSearchResponse>(`/api/meals?${params.toString()}`)
    },
    enabled: open && isSearchMode,
  })

  // Accumulate search results for pagination
  /* eslint-disable react-hooks/set-state-in-effect -- syncing derived state from query data */
  useEffect(() => {
    if (searchData) {
      const results = searchData.meals.map(toAlternativeMeal)
      if (searchOffset === 0) {
        setAccumulatedSearch(results)
      } else {
        setAccumulatedSearch((prev) => [...prev, ...results])
      }
    }
  }, [searchData, searchOffset, toAlternativeMeal])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Query 3: My recipes browse
  const { data: myRecipesData, isLoading: isLoadingMyRecipes } = useQuery({
    queryKey: ['my-recipes', mealType, myRecipesOffset],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('mealType', mealType)
      params.set('source', 'custom')
      params.set('limit', '20')
      params.set('offset', String(myRecipesOffset))
      return apiFetch<MealsSearchResponse>(`/api/meals?${params.toString()}`)
    },
    enabled: open && isMyRecipesBrowseMode,
  })

  // Accumulate my recipes results for pagination
  /* eslint-disable react-hooks/set-state-in-effect -- syncing derived state from query data */
  useEffect(() => {
    if (myRecipesData) {
      const results = myRecipesData.meals.map(toAlternativeMeal)
      if (myRecipesOffset === 0) {
        setAccumulatedMyRecipes(results)
      } else {
        setAccumulatedMyRecipes((prev) => [...prev, ...results])
      }
    }
  }, [myRecipesData, myRecipesOffset, toAlternativeMeal])
  /* eslint-enable react-hooks/set-state-in-effect */

  const displayedMeals = isMyRecipesBrowseMode
    ? accumulatedMyRecipes
    : isSearchMode
      ? accumulatedSearch
      : suggestions
  const isLoading = isMyRecipesBrowseMode
    ? isLoadingMyRecipes
    : isSearchMode
      ? isSearching
      : isLoadingSuggestions

  const searchHasMore = searchData?.hasMore ?? false
  const searchTotal = searchData?.total ?? 0
  const myRecipesHasMore = myRecipesData?.hasMore ?? false
  const myRecipesTotal = myRecipesData?.total ?? 0
  const hasSearched = !!searchData

  async function handleSelect(mealId: string) {
    setSelectingId(mealId)

    try {
      await apiFetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mealId }),
      })

      onSwapComplete()
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update meal')
      setSelectingId(null)
    }
  }

  function handleLoadMore() {
    if (isMyRecipesBrowseMode) {
      setMyRecipesOffset(accumulatedMyRecipes.length)
    } else {
      setSearchOffset(accumulatedSearch.length)
    }
  }

  const title = mode === 'swap' ? 'Choose a different meal' : 'Add a meal'
  const description =
    mode === 'swap'
      ? currentMealName
        ? `Replace "${currentMealName}" with something else`
        : 'Select one of these alternatives that match your preferences'
      : 'Select a meal for this slot'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {/* Search input */}
          <Input
            type="search"
            placeholder="Search meal library..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          {/* My recipes filter */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="my-recipes-only"
              checked={myRecipesOnly}
              onCheckedChange={(checked) => handleMyRecipesToggle(checked === true)}
            />
            <Label htmlFor="my-recipes-only" className="cursor-pointer text-sm font-normal">
              My recipes only
            </Label>
          </div>

          {/* Section header */}
          {!isLoading && !error && (
            <Body variant="small" className="text-muted-foreground">
              {isMyRecipesBrowseMode
                ? `My recipes${myRecipesTotal > 0 ? ` (${myRecipesTotal})` : ''}`
                : isSearchMode
                  ? `Search results${hasSearched ? ` (${searchTotal})` : ''}`
                  : 'Suggestions'}
            </Body>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="grid gap-4 md:grid-cols-3">
              <AlternativeSkeleton />
              <AlternativeSkeleton />
              <AlternativeSkeleton />
            </div>
          )}

          {/* Error state */}
          {error && !isLoading && (
            <Body variant="muted" className="text-center">
              {error}
            </Body>
          )}

          {/* Results grid */}
          {!isLoading && !error && displayedMeals.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-3">
                {displayedMeals.map((meal) => (
                  <AlternativeCard
                    key={meal.id}
                    meal={meal}
                    householdSize={householdSize}
                    onSelect={handleSelect}
                    isSelecting={selectingId === meal.id}
                    pantryIngredients={pantryIngredients}
                  />
                ))}
              </div>

              {/* Load more button */}
              {((isSearchMode && searchHasMore) || (isMyRecipesBrowseMode && myRecipesHasMore)) && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    disabled={isSearching || isLoadingMyRecipes}
                  >
                    {isSearching || isLoadingMyRecipes
                      ? 'Loading...'
                      : isMyRecipesBrowseMode
                        ? `Load more (${accumulatedMyRecipes.length} of ${myRecipesTotal})`
                        : `Load more (${accumulatedSearch.length} of ${searchTotal})`}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Empty state for my recipes browse */}
          {!isLoading && !error && isMyRecipesBrowseMode && accumulatedMyRecipes.length === 0 && (
            <Body variant="muted" className="text-center">
              No custom recipes yet. Try{' '}
              <a href="/recipes/import" className="text-primary underline">
                importing a recipe
              </a>{' '}
              first.
            </Body>
          )}

          {/* Empty state for search */}
          {!isLoading &&
            !error &&
            isSearchMode &&
            !isMyRecipesBrowseMode &&
            hasSearched &&
            accumulatedSearch.length === 0 && (
              <Body variant="muted" className="text-center">
                {myRecipesOnly
                  ? `No custom recipes found matching "${searchQuery}"`
                  : `No meals found matching "${searchQuery}"`}
              </Body>
            )}

          {/* Empty state for suggestions */}
          {!isLoading &&
            !error &&
            !isSearchMode &&
            !isMyRecipesBrowseMode &&
            suggestions.length === 0 && (
              <Body variant="muted" className="text-center">
                No suggestions available. Try searching for a meal.
              </Body>
            )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
