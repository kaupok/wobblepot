'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { AlternativesList } from './meal-selector/AlternativesList'
import { ImaginePanel } from './meal-selector/ImaginePanel'
import { useMealAlternatives } from './meal-selector/use-meal-alternatives'
import { apiFetch } from '@/lib/api'
import { track } from '@/lib/analytics'
import { toast } from 'sonner'
import type { PantryIngredient } from './types'
import type { MealType } from '@/generated/prisma/enums'

interface MealSelectorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  entryId: string
  mealType: MealType
  householdSize: number
  currentMealName?: string
  /** Current meal id when `mode === 'swap'`. Used as `from_meal_id` on `meal_plan:meal_swapped`. */
  currentMealId?: string
  onSwapComplete: () => void
  /** 'swap' = replacing existing meal (suggestions based on current meal), 'add' = empty slot (suggestions based on slot context) */
  mode: 'swap' | 'add'
  /** When provided, ingredient lists on cards are color-coded by pantry availability */
  pantryIngredients?: PantryIngredient[]
}

export function MealSelectorModal({
  open,
  onOpenChange,
  planId,
  entryId,
  mealType,
  householdSize,
  currentMealName,
  currentMealId,
  onSwapComplete,
  mode,
  pantryIngredients,
}: MealSelectorModalProps) {
  const tSelector = useTranslations('meal-plan.selector')

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Filter state
  const [myRecipesOnly, setMyRecipesOnly] = useState(false)

  // Shared state
  const [error, setError] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)

  const [isImagineMode, setIsImagineMode] = useState(false)

  // Debounce search input
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(id)
  }, [searchQuery, open])

  const {
    displayedMeals,
    isLoading,
    isFetchingMore,
    hasMore,
    loadMore,
    total,
    hasLoadedList,
    isSearchMode,
    isMyRecipesBrowseMode,
  } = useMealAlternatives({
    open,
    planId,
    entryId,
    mealType,
    mode,
    search: debouncedSearch,
    myRecipesOnly,
  })

  // Reset state when modal closes via the Dialog callback
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSearchQuery('')
        setDebouncedSearch('')
        setMyRecipesOnly(false)
        setError(null)
        setSelectingId(null)
        setIsImagineMode(false)
      }
      onOpenChange(newOpen)
    },
    [onOpenChange],
  )

  async function handleSelect(mealId: string) {
    setSelectingId(mealId)

    try {
      await apiFetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mealId }),
      })

      // Only fire the swap event when actually replacing an existing meal —
      // the 'add' mode is filling an empty slot, not a swap.
      if (mode === 'swap' && currentMealId) {
        void track('meal_plan:meal_swapped', {
          plan_id: planId,
          from_meal_id: currentMealId,
          to_meal_id: mealId,
          source: 'meal_selector',
        })
      }

      onSwapComplete()
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : tSelector('updateMealFailed'))
      setSelectingId(null)
    }
  }

  const handleImaginedMealSaved = async (mealId: string) => {
    // The meal is already persisted by `ImagineReviewDialog.onSaved` before
    // this handler runs — fire the event independent of the plan-assignment
    // PATCH so a transient PATCH failure doesn't drop the activation signal.
    // Mirrors the standalone imagine page flow in `ImagineClient.tsx`.
    void track('meal:imagined', { meal_id: mealId, source: 'meal_selector' })

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
      toast.error(err instanceof Error ? err.message : tSelector('imagine.assignFailed'))
    }
  }

  const title = mode === 'swap' ? tSelector('swapTitle') : tSelector('addTitle')
  const description =
    mode === 'swap'
      ? currentMealName
        ? tSelector('swapDescription', { name: currentMealName })
        : tSelector('swapDescriptionGeneric')
      : tSelector('addDescription')

  const header = isMyRecipesBrowseMode
    ? total > 0
      ? tSelector('myRecipesHeader', { count: total })
      : tSelector('myRecipesHeaderNoCount')
    : isSearchMode
      ? hasLoadedList
        ? tSelector('searchResults', { count: total })
        : tSelector('searchResultsNoCount')
      : tSelector('suggestions')

  // Each mode owns whether an empty list is worth explaining yet — search stays
  // silent until a response has actually arrived.
  let emptyState: React.ReactNode = null
  if (isMyRecipesBrowseMode) {
    emptyState = (
      <Body variant="muted" className="text-center">
        {tSelector.rich('emptyMyRecipes', {
          link: (chunks) => (
            <a href="/recipes/import" className="text-primary underline">
              {chunks}
            </a>
          ),
        })}
      </Body>
    )
  } else if (isSearchMode) {
    emptyState = hasLoadedList ? (
      <Body variant="muted" className="text-center">
        {myRecipesOnly
          ? tSelector('emptySearchCustom', { query: searchQuery })
          : tSelector('emptySearch', { query: searchQuery })}
      </Body>
    ) : null
  } else {
    emptyState = (
      <Body variant="muted" className="text-center">
        {tSelector('noSuggestions')}
      </Body>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {isImagineMode ? (
          <ImaginePanel
            onExit={() => setIsImagineMode(false)}
            onMealSaved={handleImaginedMealSaved}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Search input with imagine button */}
            <div className="flex gap-2">
              <Input
                type="search"
                placeholder={tSelector('searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsImagineMode(true)}
                title={tSelector('imagineButton')}
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
                onCheckedChange={(checked) => setMyRecipesOnly(checked === true)}
              />
              <Label htmlFor="my-recipes-only" className="cursor-pointer text-sm font-normal">
                {tSelector('myRecipesOnly')}
              </Label>
            </div>

            <AlternativesList
              meals={displayedMeals}
              isLoading={isLoading}
              error={error}
              header={header}
              emptyState={emptyState}
              householdSize={householdSize}
              selectingId={selectingId}
              onSelect={handleSelect}
              pantryIngredients={pantryIngredients}
              hasMore={hasMore}
              isLoadingMore={isFetchingMore}
              loadingLabel={tSelector('loading')}
              loadMoreLabel={tSelector('loadMore', {
                loaded: displayedMeals.length,
                total,
              })}
              onLoadMore={loadMore}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
