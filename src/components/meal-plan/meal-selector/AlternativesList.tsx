'use client'

import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Body } from '@/components/ui/typography'
import { AlternativeCard } from '../AlternativeCard'
import type { AlternativeMeal, PantryIngredient } from '../types'

/**
 * Placeholder card matching `AlternativeCard`'s footprint while meals load.
 *
 * Text bars and a button bar only: most library meals have no image, and a
 * card without one shows nothing in its place, so its skeleton reserves no
 * 3:2 band either (HON-943, DESIGN.md → Imagery).
 */
export function AlternativeSkeleton() {
  return (
    <Card size="sm" className="flex h-full flex-col">
      {/* Mirrors `AlternativeCard`: `sm` card, `p-4` content. */}
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="ml-4 h-4 w-20" />
          <Skeleton className="ml-4 h-4 w-24" />
          <Skeleton className="ml-4 h-4 w-16" />
          <Skeleton className="ml-4 h-4 w-22" />
        </div>
      </CardContent>
      {/* Mirrors `AlternativeCard`'s `CardFooter` (`p-4 pt-0`). */}
      <div className="px-4 pb-4">
        {/* The Select button: column-wide on a phone, label-wide from `md`. */}
        <Skeleton className="h-touch w-full md:h-10 md:w-20" />
      </div>
    </Card>
  )
}

export interface AlternativesListProps {
  meals: AlternativeMeal[]
  isLoading: boolean
  /** Selection error; suppresses the header, grid and empty state while shown. */
  error?: string | null
  /**
   * Section label above the grid. The three-way "suggestions / search results /
   * my recipes" copy depends on modal mode, so the caller renders it.
   */
  header?: ReactNode
  /** Rendered in place of the grid when `meals` is empty. Caller picks the copy. */
  emptyState?: ReactNode
  householdSize: number
  /** Id of the meal whose select request is in flight, if any. */
  selectingId?: string | null
  onSelect: (mealId: string) => void
  /** When provided, ingredient lists are colour-coded by pantry availability. */
  pantryIngredients?: PantryIngredient[]
  hasMore?: boolean
  isLoadingMore?: boolean
  /** Label for the load-more button; `loadingLabel` replaces it while fetching. */
  loadMoreLabel?: string
  loadingLabel?: string
  onLoadMore?: () => void
}

/**
 * Grid of selectable meal alternatives with skeleton, error, empty and
 * load-more states. Purely presentational — the caller owns data fetching.
 */
export function AlternativesList({
  meals,
  isLoading,
  error,
  header,
  emptyState,
  householdSize,
  selectingId,
  onSelect,
  pantryIngredients,
  hasMore = false,
  isLoadingMore = false,
  loadMoreLabel,
  loadingLabel,
  onLoadMore,
}: AlternativesListProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <AlternativeSkeleton />
        <AlternativeSkeleton />
        <AlternativeSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <Body variant="muted" className="text-center">
        {error}
      </Body>
    )
  }

  return (
    <>
      {header && (
        <Body variant="small" tone="muted">
          {header}
        </Body>
      )}

      {meals.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            {meals.map((meal) => (
              <AlternativeCard
                key={meal.id}
                meal={meal}
                householdSize={householdSize}
                onSelect={onSelect}
                isSelecting={selectingId === meal.id}
                pantryIngredients={pantryIngredients}
              />
            ))}
          </div>

          {hasMore && onLoadMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? loadingLabel : loadMoreLabel}
              </Button>
            </div>
          )}
        </div>
      ) : (
        emptyState
      )}
    </>
  )
}
