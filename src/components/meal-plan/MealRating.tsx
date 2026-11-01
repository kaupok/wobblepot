'use client'

import { useMutation } from '@tanstack/react-query'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Toggle } from '@/components/ui/toggle'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

import type { EntryRating } from './types'

interface MealRatingProps {
  planId: string
  entryId: string
  rating: EntryRating | null
  onRatingChange?: (rating: EntryRating | null) => void
}

/**
 * The thumbs' save: an optimistic PATCH that reverts and toasts on failure. A
 * click on the chosen thumb clears the rating. While a save is pending the
 * thumbs are `aria-disabled`, not `disabled`, so the one with focus keeps it
 * (docs/DESIGN.md → Focus management); `rate` ignores the click instead.
 */
function useMealRating({ planId, entryId, rating, onRatingChange }: MealRatingProps) {
  const t = useTranslations('meal-plan.rating')

  const rateMutation = useMutation({
    mutationFn: (targetRating: EntryRating | null) =>
      apiFetch(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: targetRating }),
        },
        t('saveFailed'),
      ),
    // Optimistic update
    onMutate: (targetRating) => {
      const previousRating = rating
      onRatingChange?.(targetRating)
      return { previousRating }
    },
    onError: (_error, _targetRating, context) => {
      // Revert on error. The server's error prose is English; the localized copy is always shown.
      if (context) onRatingChange?.(context.previousRating)
      toast.error(t('saveFailed'))
    },
  })
  const isPending = rateMutation.isPending

  function rate(newRating: EntryRating) {
    if (isPending) return
    rateMutation.mutate(newRating === rating ? null : newRating)
  }

  return { rate, isPending }
}

export function MealRatingInline(props: MealRatingProps) {
  const t = useTranslations('meal-plan.rating')
  const { rate, isPending } = useMealRating(props)
  const { rating } = props

  return (
    <div className="flex items-center gap-1">
      <Toggle
        tone="success"
        shape="circle"
        size="sm"
        pressed={rating === 'up'}
        onPressedChange={() => rate('up')}
        aria-disabled={isPending || undefined}
        aria-label={t('thumbsUp')}
      >
        <ThumbsUp className="size-4" />
      </Toggle>
      <Toggle
        tone="destructive"
        shape="circle"
        size="sm"
        pressed={rating === 'down'}
        onPressedChange={() => rate('down')}
        aria-disabled={isPending || undefined}
        aria-label={t('thumbsDown')}
      >
        <ThumbsDown className="size-4" />
      </Toggle>
    </div>
  )
}

interface CookedRatingBadgeProps extends MealRatingProps {
  isReadOnly?: boolean
}

/**
 * The planner card's Cooked badge with the rating inside it, `[Cooked | 👍 👎]`
 * (HON-1589): the status in words, so it reads without the thumbs (HON-1125),
 * then the two thumbs as one pill. A read-only card shows only the chosen thumb,
 * and the plain badge when there is none.
 */
export function CookedRatingBadge({ isReadOnly, ...props }: CookedRatingBadgeProps) {
  const tCard = useTranslations('meal-plan.card')

  if (isReadOnly) {
    return (
      <Badge variant="surface" split={!!props.rating}>
        {tCard('cooked')}
        {props.rating && <ChosenThumb rating={props.rating} />}
      </Badge>
    )
  }

  return <CookedRatingToggles {...props} />
}

function CookedRatingToggles(props: MealRatingProps) {
  const t = useTranslations('meal-plan.rating')
  const tCard = useTranslations('meal-plan.card')
  const { rate, isPending } = useMealRating(props)
  const { rating } = props

  return (
    <Badge variant="surface" split>
      {tCard('cooked')}
      <span aria-hidden="true" className="bg-border mx-0.5 h-3 w-px" />
      <Toggle
        tone="success"
        shape="circle"
        size="badge"
        pressed={rating === 'up'}
        onPressedChange={() => rate('up')}
        aria-disabled={isPending || undefined}
        aria-label={t('thumbsUp')}
      >
        <ThumbsUp className="size-3.5" />
      </Toggle>
      <Toggle
        tone="destructive"
        shape="circle"
        size="badge"
        pressed={rating === 'down'}
        onPressedChange={() => rate('down')}
        aria-disabled={isPending || undefined}
        aria-label={t('thumbsDown')}
      >
        <ThumbsDown className="size-3.5" />
      </Toggle>
    </Badge>
  )
}

/** The read-only thumb, tinted as a pressed toggle is, with its name for a screen reader. */
function ChosenThumb({ rating }: { rating: EntryRating }) {
  const t = useTranslations('meal-plan.rating')
  const isUp = rating === 'up'
  const Icon = isUp ? ThumbsUp : ThumbsDown

  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-8 items-center justify-center rounded-full',
        isUp ? 'bg-success-muted text-success' : 'bg-destructive/10 text-destructive',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{isUp ? t('thumbsUp') : t('thumbsDown')}</span>
    </span>
  )
}
