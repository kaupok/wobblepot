'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Body } from '@/components/ui/typography'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MealType, ProteinType } from '@/generated/prisma/enums'

type MealSource = 'all' | 'system' | 'custom' | 'favorites'

interface LibraryMeal {
  id: string
  name: string
  description: string | null
  timeMinutes: number | null
  kidFriendly: boolean
  primaryProteinType: ProteinType
  calories: number
  isFavorite: boolean
  isCustom: boolean
}

interface MealLibraryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  entryId: string
  mealType: MealType
  currentMealName?: string
  onSwapComplete: () => void
}

const PROTEIN_TYPE_LABELS: Record<ProteinType, string> = {
  poultry: 'Poultry',
  beef: 'Beef',
  pork: 'Pork',
  lamb: 'Lamb',
  fish: 'Fish',
  eggs: 'Eggs',
  legume: 'Legume',
  dairy: 'Dairy',
  none: 'None',
}

const PROTEIN_TYPES = Object.keys(PROTEIN_TYPE_LABELS) as ProteinType[]

function MealGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {[...Array(6)].map((_, i) => (
        <Card key={i} className="py-3">
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-1 h-8 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function MealLibraryModal({
  open,
  onOpenChange,
  planId,
  entryId,
  mealType,
  currentMealName,
  onSwapComplete,
}: MealLibraryModalProps) {
  const [meals, setMeals] = useState<LibraryMeal[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSwapping, setIsSwapping] = useState(false)

  // Confirmation dialog state
  const [confirmMeal, setConfirmMeal] = useState<LibraryMeal | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [proteinType, setProteinType] = useState<ProteinType | 'all'>('all')
  const [kidFriendlyOnly, setKidFriendlyOnly] = useState(false)
  const [source, setSource] = useState<MealSource>('all')

  // Track if initial load has happened to prevent double-fetch
  const isInitialLoad = useRef(true)

  const fetchMeals = useCallback(
    async (offset: number = 0, append: boolean = false) => {
      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
      }
      setError(null)

      try {
        const params = new URLSearchParams()
        params.set('mealType', mealType)
        params.set('limit', '20')
        params.set('offset', String(offset))
        if (search.trim()) params.set('search', search.trim())
        if (proteinType !== 'all') params.set('proteinType', proteinType)
        if (kidFriendlyOnly) params.set('kidFriendly', 'true')
        if (source !== 'all') params.set('source', source)

        const response = await fetch(`/api/meals?${params.toString()}`)

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to fetch meals')
        }

        const data = await response.json()

        if (append) {
          setMeals((prev) => [...prev, ...data.meals])
        } else {
          setMeals(data.meals)
        }
        setTotal(data.total)
        setHasMore(data.hasMore)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch meals')
      } finally {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    },
    [mealType, search, proteinType, kidFriendlyOnly, source],
  )

  // Reset and fetch on modal open
  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setMeals([])
      setError(null)
      setConfirmMeal(null)
      setIsSwapping(false)
      setSearch('')
      setProteinType('all')
      setKidFriendlyOnly(false)
      setSource('all')
      isInitialLoad.current = true
      return
    }

    // Fetch on initial open
    isInitialLoad.current = false
    fetchMeals()
  }, [open, fetchMeals])

  // Debounced filter changes (only after initial load)
  useEffect(() => {
    if (!open || isInitialLoad.current) return

    const timeoutId = setTimeout(() => {
      fetchMeals()
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [search, proteinType, kidFriendlyOnly, source, open, fetchMeals])

  function handleSelectClick(meal: LibraryMeal) {
    setConfirmMeal(meal)
  }

  async function handleToggleFavorite(meal: LibraryMeal) {
    const newFavoriteState = !meal.isFavorite
    // Optimistic update
    setMeals((prev) =>
      prev.map((m) => (m.id === meal.id ? { ...m, isFavorite: newFavoriteState } : m)),
    )

    try {
      const response = await fetch(`/api/meals/${meal.id}/favorite`, {
        method: newFavoriteState ? 'POST' : 'DELETE',
      })

      if (!response.ok) {
        // Revert on failure
        setMeals((prev) =>
          prev.map((m) => (m.id === meal.id ? { ...m, isFavorite: !newFavoriteState } : m)),
        )
        toast.error('Failed to update favorite')
      }
    } catch {
      // Revert on failure
      setMeals((prev) =>
        prev.map((m) => (m.id === meal.id ? { ...m, isFavorite: !newFavoriteState } : m)),
      )
      toast.error('Failed to update favorite')
    }
  }

  async function handleConfirmSwap() {
    if (!confirmMeal) return

    setIsSwapping(true)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mealId: confirmMeal.id }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update meal')
      }

      onSwapComplete()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update meal')
      setConfirmMeal(null)
      setIsSwapping(false)
    }
  }

  function handleLoadMore() {
    fetchMeals(meals.length, true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Browse meal library</DialogTitle>
          <DialogDescription>
            Search and filter meals to find the perfect replacement
          </DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="flex flex-col gap-3">
          <Input
            type="search"
            placeholder="Search meals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Select value={source} onValueChange={(value) => setSource(value as MealSource)}>
              <SelectTrigger size="sm" className="w-[140px]">
                <SelectValue placeholder="All meals" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All meals</SelectItem>
                <SelectItem value="system">System meals</SelectItem>
                <SelectItem value="custom">Our meals</SelectItem>
                <SelectItem value="favorites">Favorites</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={proteinType}
              onValueChange={(value) => setProteinType(value as ProteinType | 'all')}
            >
              <SelectTrigger size="sm" className="w-[140px]">
                <SelectValue placeholder="All proteins" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All proteins</SelectItem>
                {PROTEIN_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {PROTEIN_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Checkbox
                id="kid-friendly"
                checked={kidFriendlyOnly}
                onCheckedChange={(checked) => setKidFriendlyOnly(checked === true)}
              />
              <Label htmlFor="kid-friendly" className="text-sm">
                Kid-friendly only
              </Label>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && <MealGridSkeleton />}

          {error && !isLoading && (
            <Body variant="muted" className="py-8 text-center">
              {error}
            </Body>
          )}

          {!isLoading && !error && meals.length === 0 && (
            <Body variant="muted" className="py-8 text-center">
              No meals found matching your filters
            </Body>
          )}

          {!isLoading && !error && meals.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {meals.map((meal) => (
                  <Card key={meal.id} className="py-3">
                    <CardContent className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-sm leading-tight font-medium">{meal.name}</span>
                          <button
                            type="button"
                            onClick={() => handleToggleFavorite(meal)}
                            className="flex-shrink-0 p-0.5"
                            aria-label={
                              meal.isFavorite ? 'Remove from favorites' : 'Add to favorites'
                            }
                          >
                            <Heart
                              className={`h-4 w-4 ${
                                meal.isFavorite
                                  ? 'fill-red-500 text-red-500'
                                  : 'text-muted-foreground hover:text-red-500'
                              }`}
                            />
                          </button>
                        </div>
                        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                          {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
                          <span>
                            {meal.timeMinutes && '• '}
                            {meal.calories} kcal
                          </span>
                          {meal.kidFriendly && (
                            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              Kid-friendly
                            </span>
                          )}
                          {meal.isCustom && (
                            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                              Custom
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => handleSelectClick(meal)}
                        disabled={isSwapping}
                      >
                        Select
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
                    {isLoadingMore ? 'Loading...' : `Load more (${meals.length} of ${total})`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
      <ConfirmDialog
        open={confirmMeal !== null}
        onOpenChange={(open) => !open && setConfirmMeal(null)}
        title="Swap meal"
        description={
          currentMealName
            ? `Replace "${currentMealName}" with "${confirmMeal?.name}"?`
            : `Select "${confirmMeal?.name}" for this meal?`
        }
        confirmLabel="Swap"
        loadingLabel="Swapping..."
        onConfirm={handleConfirmSwap}
        isLoading={isSwapping}
      />
    </Dialog>
  )
}
