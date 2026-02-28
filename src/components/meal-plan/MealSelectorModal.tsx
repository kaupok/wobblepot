'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  // AI suggestions state
  const [suggestions, setSuggestions] = useState<AlternativeMeal[]>([])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AlternativeMeal[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchTotal, setSearchTotal] = useState(0)

  // Filter state
  const [myRecipesOnly, setMyRecipesOnly] = useState(false)
  const [myRecipes, setMyRecipes] = useState<AlternativeMeal[]>([])
  const [isLoadingMyRecipes, setIsLoadingMyRecipes] = useState(false)
  const [myRecipesHasMore, setMyRecipesHasMore] = useState(false)
  const [myRecipesTotal, setMyRecipesTotal] = useState(0)

  // Shared state
  const [error, setError] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)

  // Track initial load
  const isInitialLoad = useRef(true)

  // Determine display mode
  const isSearchMode = searchQuery.trim().length > 0
  const isMyRecipesBrowseMode = myRecipesOnly && !isSearchMode
  const displayedMeals = isMyRecipesBrowseMode
    ? myRecipes
    : isSearchMode
      ? searchResults
      : suggestions
  const isLoading = isMyRecipesBrowseMode
    ? isLoadingMyRecipes
    : isSearchMode
      ? isSearching
      : isLoadingSuggestions

  // Fetch AI suggestions on modal open
  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setSuggestions([])
      setSearchQuery('')
      setSearchResults([])
      setHasSearched(false)
      setSearchHasMore(false)
      setSearchTotal(0)
      setMyRecipesOnly(false)
      setMyRecipes([])
      setMyRecipesHasMore(false)
      setMyRecipesTotal(0)
      setError(null)
      setSelectingId(null)
      isInitialLoad.current = true
      return
    }

    async function fetchData() {
      setIsLoadingSuggestions(true)
      setError(null)

      try {
        // Different endpoint based on mode:
        // - swap: uses /regenerate which considers current meal
        // - add: uses /suggestions which considers slot context
        const suggestionsEndpoint =
          mode === 'swap'
            ? `/api/meal-plans/${planId}/entries/${entryId}/regenerate`
            : `/api/meal-plans/${planId}/entries/${entryId}/suggestions`

        const response = await fetch(suggestionsEndpoint, {
          method: 'POST',
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to fetch suggestions')
        }

        const suggestionsData = await response.json()
        // Both endpoints return { alternatives: [...] } or { suggestions: [...] }
        setSuggestions(suggestionsData.alternatives || suggestionsData.suggestions || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch suggestions')
      } finally {
        setIsLoadingSuggestions(false)
        isInitialLoad.current = false
      }
    }

    fetchData()
  }, [open, planId, entryId, mode])

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

  // Search library meals with debounce
  const searchMeals = useCallback(
    async (query: string, offset: number = 0, append: boolean = false) => {
      if (!query.trim()) {
        setSearchResults([])
        setHasSearched(false)
        setSearchHasMore(false)
        setSearchTotal(0)
        return
      }

      setIsSearching(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        params.set('mealType', mealType)
        params.set('search', query.trim())
        params.set('limit', '20')
        params.set('offset', String(offset))
        if (myRecipesOnly) {
          params.set('source', 'custom')
        }

        const response = await fetch(`/api/meals?${params.toString()}`)

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to search meals')
        }

        const data = await response.json()
        const results: AlternativeMeal[] = data.meals.map(toAlternativeMeal)

        if (append) {
          setSearchResults((prev) => [...prev, ...results])
        } else {
          setSearchResults(results)
        }
        setHasSearched(true)
        setSearchHasMore(data.hasMore)
        setSearchTotal(data.total)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to search meals')
      } finally {
        setIsSearching(false)
      }
    },
    [mealType, myRecipesOnly, toAlternativeMeal],
  )

  // Fetch household recipes (when myRecipesOnly is checked and no search term)
  const fetchMyRecipes = useCallback(
    async (offset: number = 0, append: boolean = false) => {
      setIsLoadingMyRecipes(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        params.set('mealType', mealType)
        params.set('source', 'custom')
        params.set('limit', '20')
        params.set('offset', String(offset))

        const response = await fetch(`/api/meals?${params.toString()}`)

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to fetch recipes')
        }

        const data = await response.json()
        const results: AlternativeMeal[] = data.meals.map(toAlternativeMeal)

        if (append) {
          setMyRecipes((prev) => [...prev, ...results])
        } else {
          setMyRecipes(results)
        }
        setMyRecipesHasMore(data.hasMore)
        setMyRecipesTotal(data.total)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch recipes')
      } finally {
        setIsLoadingMyRecipes(false)
      }
    },
    [mealType, toAlternativeMeal],
  )

  // Debounced search effect
  useEffect(() => {
    if (!open || isInitialLoad.current) return

    const timeoutId = setTimeout(() => {
      searchMeals(searchQuery)
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [searchQuery, open, searchMeals])

  // Fetch my recipes when filter is toggled on (and no search term)
  useEffect(() => {
    if (!open || !myRecipesOnly || isSearchMode) return

    fetchMyRecipes()
  }, [open, myRecipesOnly, isSearchMode, fetchMyRecipes])

  async function handleSelect(mealId: string) {
    setSelectingId(mealId)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mealId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update meal')
      }

      onSwapComplete()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update meal')
      setSelectingId(null)
    }
  }

  function handleLoadMore() {
    if (isMyRecipesBrowseMode) {
      fetchMyRecipes(myRecipes.length, true)
    } else {
      searchMeals(searchQuery, searchResults.length, true)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onCheckedChange={(checked) => setMyRecipesOnly(checked === true)}
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
                        ? `Load more (${myRecipes.length} of ${myRecipesTotal})`
                        : `Load more (${searchResults.length} of ${searchTotal})`}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Empty state for my recipes browse */}
          {!isLoading && !error && isMyRecipesBrowseMode && myRecipes.length === 0 && (
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
            searchResults.length === 0 && (
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
