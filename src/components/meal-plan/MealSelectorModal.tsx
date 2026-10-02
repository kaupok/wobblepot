'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
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
import { ApiError, apiFetch } from '@/lib/api'
import { track } from '@/lib/analytics'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { formatAbsoluteDate, formatDayLong, formatDayShort } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { toast } from 'sonner'
import type { PantryIngredient } from './types'
import type { MealType } from '@/generated/prisma/enums'

/**
 * Breadcrumb for a failed plan-entry PATCH. The PATCH route sets an English
 * `error` on every failure branch, and `apiFetch` copies it into
 * `Error.message` verbatim — rendering that showed English to an Estonian
 * household on the step right after a localized imagine (HON-724). None of
 * the branches reachable from this modal needs distinct copy, so both callers
 * render their own translated message and the server prose lives here only.
 */
function logAssignFailure(err: unknown) {
  console.error('[meal-selector] plan entry update failed', {
    status: err instanceof ApiError ? err.status : undefined,
    error: err instanceof Error ? err.message : err,
  })
}

interface MealSelectorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  entryId: string
  mealType: MealType
  /**
   * The slot's date (YYYY-MM-DD). In add mode the title then names the slot,
   * since the dialog covers the row that was tapped (HON-807, HON-941).
   */
  date?: string
  /** Set when `date` is today or tomorrow: the title says the word, not the date. */
  relativeDay?: 'today' | 'tomorrow'
  householdSize: number
  currentMealName?: string
  /** Current meal id when `mode === 'swap'`. Used as `from_meal_id` on `meal_plan:meal_swapped`. */
  currentMealId?: string
  /**
   * Called with the meal id that was selected, which is NOT always a different
   * meal: search and "my recipes" browse list the dish already on the entry
   * (only `/regenerate` filters it out), so a re-select is a no-op write. The
   * server resets `servingOverride`, `preparationTips` and `rating` only when
   * the meal actually changes (HON-703), so the callback has to be able to
   * draw the same distinction rather than reset unconditionally.
   */
  onSwapComplete: (selectedMealId: string) => void
  /** 'swap' = replacing existing meal (suggestions based on current meal), 'add' = empty slot (suggestions based on slot context) */
  mode: 'swap' | 'add'
  /** When provided, ingredient lists on cards are color-coded by pantry availability */
  pantryIngredients?: PantryIngredient[]
  /**
   * Passed to `DialogContent`. The selector opens without a `DialogTrigger`,
   * and a modal Radix dialog returns focus only to its trigger, so without
   * this it lands on the page body on close (HON-803). Call
   * `event.preventDefault()` and focus the element that opened the selector.
   */
  onCloseAutoFocus?: (event: Event) => void
}

export function MealSelectorModal({
  open,
  onOpenChange,
  planId,
  entryId,
  mealType,
  date,
  relativeDay,
  householdSize,
  currentMealName,
  currentMealId,
  onSwapComplete,
  mode,
  pantryIngredients,
  onCloseAutoFocus,
}: MealSelectorModalProps) {
  const tSelector = useTranslations('meal-plan.selector')
  const locale = useLocale() as Locale
  const mealTypeLabel = useEnumLabel('MealType', mealType)

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
    reset,
    total,
    hasLoadedList,
    isSearchMode,
    isMyRecipesBrowseMode,
    isRateLimited,
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
        // Pagination lives in the query cache, and this modal never unmounts,
        // so cached pages would otherwise be replayed on the next open.
        reset()
      }
      onOpenChange(newOpen)
    },
    [onOpenChange, reset],
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
      // the 'add' mode is filling an empty slot, not a swap. Re-selecting the
      // planned meal still fires, marked `is_reselect` (HON-708).
      if (mode === 'swap' && currentMealId) {
        void track('meal_plan:meal_swapped', {
          plan_id: planId,
          from_meal_id: currentMealId,
          to_meal_id: mealId,
          source: 'meal_selector',
          is_reselect: mealId === currentMealId,
          via: 'library',
        })
      }

      onSwapComplete(mealId)
      handleOpenChange(false)
    } catch (err) {
      // `apiFetch` puts the route's English `error` in `message`, so it is
      // logged, never rendered (HON-724) — see `logAssignFailure`.
      logAssignFailure(err)
      setError(tSelector('updateMealFailed'))
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

      // Replacing a planned meal with an imagined one is a swap too (HON-890).
      // The meal was just created, so it can never be the one already planned.
      if (mode === 'swap' && currentMealId) {
        void track('meal_plan:meal_swapped', {
          plan_id: planId,
          from_meal_id: currentMealId,
          to_meal_id: mealId,
          source: 'meal_selector',
          is_reselect: false,
          via: 'imagine',
        })
      }

      setIsImagineMode(false)
      onSwapComplete(mealId)
      handleOpenChange(false)
    } catch (err) {
      logAssignFailure(err)
      toast.error(tSelector('imagine.assignFailed'))
    }
  }

  function slotTitleForms(isoDate: string) {
    // Mid-sentence in the long form, so lowercase; it opens the short form.
    const mealTypeLower = mealTypeLabel.toLocaleLowerCase(locale)
    if (relativeDay) {
      // No date beside today or tomorrow, as on the timeline's day heading.
      const day = tSelector(`relativeDay.${relativeDay}`)
      return {
        long: tSelector('addSlotTitleRelative', { mealType: mealTypeLower, day }),
        short: tSelector('addSlotTitleRelativeShort', { mealType: mealTypeLabel, day }),
      }
    }
    const parsed = parseLocalDate(isoDate)
    const formattedDate = formatAbsoluteDate(parsed, locale)
    // The date is a detail beside the weekday, dimmed as `TimelineDayCard` does,
    // and kept whole ("20. märts") if a narrow phone wraps the title.
    const dim = (chunks: React.ReactNode) => (
      <span className="text-muted-foreground font-normal whitespace-nowrap">{chunks}</span>
    )
    return {
      long: tSelector.rich('addSlotTitle', {
        mealType: mealTypeLower,
        weekday: formatDayLong(parsed, locale),
        date: formattedDate,
        dim,
      }),
      short: tSelector.rich('addSlotTitleShort', {
        mealType: mealTypeLabel,
        weekday: formatDayShort(parsed, locale),
        date: formattedDate,
        dim,
      }),
    }
  }

  // An empty slot's title is one sentence naming the slot, long from `md` and
  // short below it, where the long form does not fit a phone (HON-941). The
  // centred phone header leaves the title 244px at 390px; the widest short
  // forms ("Hommikusöök: R 20. märts") are 253px at normal tracking and fit
  // tight. `MealSelectorModal.stories.tsx` → `DatedSlotPhone*` measure them.
  const slotTitle = mode === 'add' && date ? slotTitleForms(date) : null
  const title = slotTitle ? (
    <>
      <span className="tracking-tight md:hidden">{slotTitle.short}</span>
      <span className="hidden md:inline">{slotTitle.long}</span>
    </>
  ) : mode === 'swap' ? (
    tSelector('swapTitle')
  ) : (
    tSelector('addTitle')
  )
  const description =
    mode === 'swap'
      ? currentMealName
        ? tSelector('swapDescription', { name: currentMealName })
        : tSelector('swapDescriptionGeneric')
      : slotTitle
        ? null
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
          : tSelector.rich('emptySearch', {
              query: searchQuery,
              // The fact, then the next step: the same action as the sparkles
              // button, so the search is still there on the way back (HON-944).
              imagine: (chunks) => (
                <Button variant="link" size="inline" onClick={() => setIsImagineMode(true)}>
                  {chunks}
                </Button>
              ),
            })}
      </Body>
    ) : null
  } else {
    emptyState = (
      <Body variant="muted" className="text-center">
        {isRateLimited ? tSelector('rateLimited') : tSelector('noSuggestions')}
      </Body>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-dialog overflow-y-auto sm:max-w-4xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {/* The slot title says it all. Radix sets `aria-describedby` only
              while a description is mounted, so leaving it out is enough. */}
          {description !== null && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {isImagineMode ? (
          <ImaginePanel
            mealType={mealType}
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
                aria-label={tSelector('searchAria')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsImagineMode(true)}
                aria-label={tSelector('imagineButton')}
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
              <Label htmlFor="my-recipes-only" className="cursor-pointer font-normal">
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
