'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Sparkles, ArrowLeft, ImagePlus, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Body } from '@/components/ui/typography'
import { AlternativeCard } from './AlternativeCard'
import { MealCardBase } from './MealCardBase'
import { ImagineReviewDialog, type ReviewMealData } from '@/components/recipes/ImagineReviewDialog'
import { apiFetch } from '@/lib/api'
import { convertToPrefilledData, type ImaginedMealResponse } from '@/lib/imagine-utils'
import { toast } from 'sonner'
import type { AlternativeMeal, MealComponent, NutritionData, PantryIngredient } from './types'
import type { MealType, ProteinType } from '@/generated/prisma/enums'

const MAX_IMAGES = 3
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

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

  // Imagine mode state
  const [isImagineMode, setIsImagineMode] = useState(false)
  const [imaginePrompt, setImaginePrompt] = useState('')
  const [imagineImages, setImagineImages] = useState<File[]>([])
  const [imaginedMeals, setImaginedMeals] = useState<ImaginedMealResponse[] | null>(null)
  const [isImagining, setIsImagining] = useState(false)
  const [imagineError, setImagineError] = useState<string | null>(null)
  const [reviewMeal, setReviewMeal] = useState<ReviewMealData | null>(null)
  const [reviewingMealId, setReviewingMealId] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlsRef = useRef<string[]>([])

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

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

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
        // Reset imagine state
        abortControllerRef.current?.abort()
        setIsImagineMode(false)
        setImaginePrompt('')
        setImagineImages([])
        setImaginedMeals(null)
        setIsImagining(false)
        setImagineError(null)
        setReviewMeal(null)
        setReviewingMealId(null)
        objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
        objectUrlsRef.current = []
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
    staleTime: Infinity,
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

  // Imagine mode handlers
  const handleExitImagineMode = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsImagineMode(false)
    setImaginePrompt('')
    setImagineImages([])
    setImaginedMeals(null)
    setIsImagining(false)
    setImagineError(null)
    setReviewingMealId(null)
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrlsRef.current = []
  }, [])

  const handleImagineFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      e.target.value = ''

      const available = MAX_IMAGES - imagineImages.length
      if (files.length > available) {
        toast.error(`You can attach up to ${MAX_IMAGES} images`)
        return
      }

      for (const file of files) {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
          toast.error('Images must be JPEG, PNG, or WebP')
          return
        }
        if (file.size > MAX_IMAGE_SIZE) {
          toast.error('Each image must be 5 MB or less')
          return
        }
      }

      const newUrls = files.map((f) => URL.createObjectURL(f))
      objectUrlsRef.current = [...objectUrlsRef.current, ...newUrls]
      setImagineImages((prev) => [...prev, ...files])
    },
    [imagineImages.length],
  )

  const removeImagineImage = useCallback((index: number) => {
    setImagineImages((prev) => {
      const url = objectUrlsRef.current[index]
      if (url) URL.revokeObjectURL(url)
      objectUrlsRef.current = objectUrlsRef.current.filter((_, i) => i !== index)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleImagineGenerate = async () => {
    if (!imaginePrompt.trim() && imagineImages.length === 0) {
      setImagineError('Please describe what kind of meal you want or attach a photo')
      return
    }

    setImagineError(null)
    setImaginedMeals(null)
    setIsImagining(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      let response: Response
      if (imagineImages.length > 0) {
        const formData = new FormData()
        if (imaginePrompt.trim()) {
          formData.append('prompt', imaginePrompt.trim())
        }
        for (const image of imagineImages) {
          formData.append('image', image)
        }
        response = await fetch('/api/meals/imagine', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })
      } else {
        response = await fetch('/api/meals/imagine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: imaginePrompt.trim() }),
          signal: controller.signal,
        })
      }

      const data = await response.json()

      if (!response.ok || !data.success) {
        setImagineError(data.error || data.message || 'Failed to generate meal ideas')
        return
      }

      setImaginedMeals(data.meals)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setImagineError('Failed to generate meal ideas. Please try again.')
    } finally {
      abortControllerRef.current = null
      setIsImagining(false)
    }
  }

  const handleImagineCancel = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsImagining(false)
  }

  const handleSelectImaginedMeal = async (meal: ImaginedMealResponse) => {
    setReviewingMealId(meal.id)

    let finalMeal = meal
    try {
      const reviewPayload = {
        mealName: meal.name,
        servings: meal.servings,
        ingredients: meal.components.map((comp) => ({
          ingredientId: comp.ingredientId,
          name: comp.ingredient.name,
          quantityPerServing: comp.quantityPerServing,
          unit: comp.ingredient.defaultUnit,
        })),
      }

      const response = await fetch('/api/meals/imagine/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewPayload),
        signal: AbortSignal.timeout(15_000),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.ingredients) {
          const correctionMap = new Map<string, number>(
            data.ingredients.map((ing: { ingredientId: string; quantityPerServing: number }) => [
              ing.ingredientId,
              ing.quantityPerServing,
            ]),
          )

          finalMeal = {
            ...meal,
            components: meal.components.map((comp) => {
              const corrected = correctionMap.get(comp.ingredientId)
              return corrected != null ? { ...comp, quantityPerServing: corrected } : comp
            }),
            ingredients: meal.ingredients.map((ing) => {
              if (ing.type !== 'matched') return ing
              const corrected = correctionMap.get(ing.ingredient.id)
              return corrected != null
                ? { ...ing, convertedQuantity: corrected * meal.servings }
                : ing
            }),
          }
        }
      }
    } catch {
      // Graceful degradation: proceed with original quantities
    }

    setReviewingMealId(null)
    const prefilledData = convertToPrefilledData(finalMeal)
    setReviewMeal({
      ...prefilledData,
      nutrition: finalMeal.nutrition,
    })
  }

  const handleImaginedMealSaved = async (mealId: string) => {
    setReviewMeal(null) // Close sheet immediately to prevent duplicate saves
    try {
      await apiFetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mealId }),
      })

      setIsImagineMode(false)
      onSwapComplete()
      handleOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign meal to plan')
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
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {isImagineMode ? (
            /* ── Imagine mode ── */
            <div className="flex flex-col gap-4">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 self-start"
                onClick={handleExitImagineMode}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to library
              </Button>

              <div className="flex gap-2">
                <Textarea
                  value={imaginePrompt}
                  onChange={(e) => {
                    setImaginePrompt(e.target.value)
                    setImagineError(null)
                  }}
                  placeholder="Something healthy with chicken and a fresh salad..."
                  rows={3}
                  className="min-w-0 flex-1 resize-none"
                  disabled={isImagining}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleImagineGenerate()
                    }
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={handleImagineFileSelect}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 self-end"
                  disabled={isImagining || imagineImages.length >= MAX_IMAGES}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach photos"
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
              </div>

              {imagineImages.length > 0 && (
                <div className="flex gap-2">
                  {imagineImages.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}`} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element -- blob URL preview, not optimizable */}
                      <img
                        src={objectUrlsRef.current[index]}
                        alt={file.name}
                        className="h-16 w-16 rounded-md border object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImagineImage(index)}
                        disabled={isImagining}
                        className="bg-background/80 absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {imagineError && (
                <Body variant="small" className="text-destructive">
                  {imagineError}
                </Body>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleImagineGenerate}
                  disabled={
                    isImagining ||
                    reviewingMealId !== null ||
                    (!imaginePrompt.trim() && imagineImages.length === 0)
                  }
                  className="w-full"
                >
                  {isImagining ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating ideas...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Imagine meals
                    </>
                  )}
                </Button>
                {isImagining && (
                  <Button variant="ghost" size="sm" onClick={handleImagineCancel}>
                    Cancel
                  </Button>
                )}
              </div>

              {/* Imagined meal results */}
              {(isImagining || imaginedMeals) && (
                <div className="grid gap-4 sm:grid-cols-3">
                  {isImagining
                    ? Array.from({ length: 3 }).map((_, i) => <AlternativeSkeleton key={i} />)
                    : imaginedMeals?.map((meal) => (
                        <Card key={meal.id} className="flex h-full flex-col">
                          <CardContent className="flex-1 p-4 pb-2">
                            <MealCardBase meal={meal} />
                          </CardContent>
                          <CardFooter className="p-4 pt-0">
                            <Button
                              className="w-full"
                              onClick={() => handleSelectImaginedMeal(meal)}
                              disabled={reviewingMealId !== null}
                            >
                              {reviewingMealId === meal.id ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Fine-tuning recipe...
                                </>
                              ) : (
                                'Select'
                              )}
                            </Button>
                          </CardFooter>
                        </Card>
                      ))}
                </div>
              )}
            </div>
          ) : (
            /* ── Library mode (default) ── */
            <div className="flex flex-col gap-4">
              {/* Search input with imagine button */}
              <div className="flex gap-2">
                <Input
                  type="search"
                  placeholder="Search meal library..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsImagineMode(true)}
                  title="Imagine a meal"
                  className="shrink-0"
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </div>

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
                  {((isSearchMode && searchHasMore) ||
                    (isMyRecipesBrowseMode && myRecipesHasMore)) && (
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
              {!isLoading &&
                !error &&
                isMyRecipesBrowseMode &&
                accumulatedMyRecipes.length === 0 && (
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
          )}
        </DialogContent>
      </Dialog>

      {/* Imagine review dialog - rendered outside main Dialog to avoid z-index issues */}
      {reviewMeal && (
        <ImagineReviewDialog
          open={!!reviewMeal}
          onOpenChange={(open) => {
            if (!open) setReviewMeal(null)
          }}
          meal={reviewMeal}
          onSaved={handleImaginedMealSaved}
        />
      )}
    </>
  )
}
