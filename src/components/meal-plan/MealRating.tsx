'use client'

import { useMutation } from '@tanstack/react-query'
import { ThumbsUp, ThumbsDown, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { Body } from '@/components/ui/typography'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { EntryRating } from './types'

interface MealRatingPromptProps {
  planId: string
  entryId: string
  onRated?: (rating: EntryRating) => void
  onDismiss?: () => void
}

export function MealRatingPrompt({ planId, entryId, onRated, onDismiss }: MealRatingPromptProps) {
  const t = useTranslations('meal-plan.rating')

  const rateMutation = useMutation({
    mutationFn: (rating: EntryRating) =>
      apiFetch(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating }),
        },
        t('saveFailed'),
      ),
    onSuccess: (_data, rating) => onRated?.(rating),
    // The server's error prose is English; the localized copy is always shown.
    onError: () => toast.error(t('saveFailed')),
  })
  const isSubmitting = rateMutation.isPending

  function handleRate(rating: EntryRating) {
    rateMutation.mutate(rating)
  }

  return (
    <div className="bg-success-muted flex items-center gap-2 rounded-lg px-3 py-2">
      <Body variant="small" tone="success">
        {t('prompt')}
      </Body>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => handleRate('up')}
          disabled={isSubmitting}
          aria-label={t('thumbsUp')}
        >
          <ThumbsUp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => handleRate('down')}
          disabled={isSubmitting}
          aria-label={t('thumbsDown')}
        >
          <ThumbsDown className="size-4" />
        </Button>
      </div>
      <Button
        variant="quiet"
        size="icon-sm"
        className="ml-auto"
        onClick={onDismiss}
        disabled={isSubmitting}
        aria-label={t('dismiss')}
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}

interface RatingBadgeProps {
  rating: EntryRating
  onClick?: () => void
}

export function RatingBadge({ rating, onClick }: RatingBadgeProps) {
  const t = useTranslations('meal-plan.rating')
  const isUp = rating === 'up'

  const badge = (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
        isUp ? 'bg-success-muted text-success' : 'bg-destructive/10 text-destructive',
      )}
    >
      {/* `size-3.5`, not `h-3.5 w-3.5`: the clickable badge sits inside a `Button`, whose
          `[&_svg:not([class*=size-])]:size-4` would otherwise grow the icon. */}
      {isUp ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
    </span>
  )

  if (onClick) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        aria-label={t('ariaCurrent', {
          direction: isUp ? t('directionUp') : t('directionDown'),
        })}
      >
        {badge}
      </Button>
    )
  }

  return badge
}

interface MealRatingInlineProps {
  planId: string
  entryId: string
  rating: EntryRating | null
  onRatingChange?: (rating: EntryRating | null) => void
}

export function MealRatingInline({
  planId,
  entryId,
  rating,
  onRatingChange,
}: MealRatingInlineProps) {
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
      // Revert on error
      if (context) onRatingChange?.(context.previousRating)
      toast.error(t('saveFailed'))
    },
  })
  const isSubmitting = rateMutation.isPending

  function handleRate(newRating: EntryRating) {
    // Toggle off if same rating clicked
    rateMutation.mutate(newRating === rating ? null : newRating)
  }

  return (
    <div className="flex items-center gap-1">
      <Toggle
        tone="success"
        shape="circle"
        size="sm"
        pressed={rating === 'up'}
        onPressedChange={() => handleRate('up')}
        disabled={isSubmitting}
        aria-label={t('thumbsUp')}
      >
        <ThumbsUp className="size-4" />
      </Toggle>
      <Toggle
        tone="destructive"
        shape="circle"
        size="sm"
        pressed={rating === 'down'}
        onPressedChange={() => handleRate('down')}
        disabled={isSubmitting}
        aria-label={t('thumbsDown')}
      >
        <ThumbsDown className="size-4" />
      </Toggle>
    </div>
  )
}
