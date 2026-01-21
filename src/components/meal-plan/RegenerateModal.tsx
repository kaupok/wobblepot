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
import { Skeleton } from '@/components/ui/skeleton'
import { Body } from '@/components/ui/typography'
import { AlternativeCard } from './AlternativeCard'
import { MealLibraryModal } from './MealLibraryModal'
import type { AlternativeMeal, MealComponent, NutritionData, PantryIngredient } from './types'
import type { MealType, ProteinType } from '@/generated/prisma/enums'

interface RegenerateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  entryId: string
  mealType: MealType
  householdSize: number
  currentMealName?: string
  onSwapComplete: () => void
}

// Type for the /api/meals response
interface LibraryMeal {
  id: string
  name: string
  description: string | null
  timeMinutes: number | null
  kidFriendly: boolean
  primaryProteinType: ProteinType
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

export function RegenerateModal({
  open,
  onOpenChange,
  planId,
  entryId,
  mealType,
  householdSize,
  currentMealName,
  onSwapComplete,
}: RegenerateModalProps) {
  // AI alternatives state
  const [alternatives, setAlternatives] = useState<AlternativeMeal[]>([])
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AlternativeMeal[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Shared state
  const [pantryIngredients, setPantryIngredients] = useState<PantryIngredient[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)

  // Track initial load
  const isInitialLoad = useRef(true)

  // Determine if we're in search mode
  const isSearchMode = searchQuery.trim().length > 0
  const displayedMeals = isSearchMode ? searchResults : alternatives
  const isLoading = isSearchMode ? isSearching : isLoadingAlternatives

  // Fetch AI alternatives and pantry on modal open
  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setAlternatives([])
      setPantryIngredients([])
      setSearchQuery('')
      setSearchResults([])
      setHasSearched(false)
      setError(null)
      setSelectingId(null)
      isInitialLoad.current = true
      return
    }

    async function fetchData() {
      setIsLoadingAlternatives(true)
      setError(null)

      try {
        // Fetch alternatives and pantry in parallel
        const [alternativesResponse, pantryResponse] = await Promise.all([
          fetch(`/api/meal-plans/${planId}/entries/${entryId}/regenerate`, {
            method: 'POST',
          }),
          fetch('/api/pantry'),
        ])

        if (!alternativesResponse.ok) {
          const data = await alternativesResponse.json()
          throw new Error(data.error || 'Failed to fetch alternatives')
        }

        const alternativesData = await alternativesResponse.json()
        setAlternatives(alternativesData.alternatives)

        // Parse pantry response
        if (pantryResponse.ok) {
          const pantryData = await pantryResponse.json()
          const ingredients: PantryIngredient[] = pantryData.items.map(
            (item: { ingredient: { id: string }; isStaple: boolean }) => ({
              ingredientId: item.ingredient.id,
              isStaple: item.isStaple,
            }),
          )
          setPantryIngredients(ingredients)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch alternatives')
      } finally {
        setIsLoadingAlternatives(false)
        isInitialLoad.current = false
      }
    }

    fetchData()
  }, [open, planId, entryId])

  // Search library meals with debounce
  const searchMeals = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults([])
        setHasSearched(false)
        return
      }

      setIsSearching(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        params.set('mealType', mealType)
        params.set('search', query.trim())
        params.set('limit', '20')

        const response = await fetch(`/api/meals?${params.toString()}`)

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to search meals')
        }

        const data = await response.json()

        // Transform library meals to AlternativeMeal format
        const results: AlternativeMeal[] = data.meals.map((meal: LibraryMeal) => ({
          id: meal.id,
          name: meal.name,
          timeMinutes: meal.timeMinutes,
          kidFriendly: meal.kidFriendly,
          primaryProteinType: meal.primaryProteinType,
          reason: '', // No AI reason for search results
          components: meal.components,
          nutrition: meal.nutrition,
        }))

        setSearchResults(results)
        setHasSearched(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to search meals')
      } finally {
        setIsSearching(false)
      }
    },
    [mealType],
  )

  // Debounced search effect
  useEffect(() => {
    if (!open || isInitialLoad.current) return

    const timeoutId = setTimeout(() => {
      searchMeals(searchQuery)
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [searchQuery, open, searchMeals])

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

  function handleBrowseLibrary() {
    onOpenChange(false)
    setIsLibraryOpen(true)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Choose a different meal</DialogTitle>
            <DialogDescription>
              {isSearchMode
                ? 'Search results from meal library'
                : 'Select one of these alternatives that match your preferences'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {/* Search input */}
            <Input
              type="search"
              placeholder="Search meal library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

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
            )}

            {/* Empty state for search */}
            {!isLoading && !error && isSearchMode && hasSearched && searchResults.length === 0 && (
              <Body variant="muted" className="text-center">
                No meals found matching &quot;{searchQuery}&quot;
              </Body>
            )}

            {/* Empty state for alternatives */}
            {!isLoading && !error && !isSearchMode && alternatives.length === 0 && (
              <Body variant="muted" className="text-center">
                No alternatives available
              </Body>
            )}

            {/* Browse full library button - only show when not searching */}
            {!isLoading && !isSearchMode && (
              <div className="border-t pt-3">
                <Button variant="outline" className="w-full" onClick={handleBrowseLibrary}>
                  Browse full library
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <MealLibraryModal
        open={isLibraryOpen}
        onOpenChange={setIsLibraryOpen}
        planId={planId}
        entryId={entryId}
        mealType={mealType}
        currentMealName={currentMealName}
        onSwapComplete={onSwapComplete}
      />
    </>
  )
}
