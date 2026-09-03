'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
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
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleRate(rating: EntryRating) {
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      })

      if (!response.ok) {
        toast.error(t('saveFailed'))
        return
      }

      onRated?.(rating)
    } catch {
      toast.error(t('saveFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="bg-success-muted flex items-center gap-2 rounded-lg px-3 py-2">
      <Body variant="small" className="text-success">
        {t('prompt')}
      </Body>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => handleRate('up')}
          disabled={isSubmitting}
          aria-label={t('thumbsUp')}
        >
          <ThumbsUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => handleRate('down')}
          disabled={isSubmitting}
          aria-label={t('thumbsDown')}
        >
          <ThumbsDown className="h-4 w-4" />
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground ml-auto h-6 w-6 p-0"
        onClick={onDismiss}
        disabled={isSubmitting}
        aria-label={t('dismiss')}
      >
        <X className="h-3.5 w-3.5" />
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
      {isUp ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
    </span>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer"
        aria-label={t('ariaCurrent', {
          direction: isUp ? t('directionUp') : t('directionDown'),
        })}
      >
        {badge}
      </button>
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
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleRate(newRating: EntryRating) {
    // Toggle off if same rating clicked
    const targetRating = newRating === rating ? null : newRating
    const previousRating = rating

    // Optimistic update
    onRatingChange?.(targetRating)
    setIsSubmitting(true)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: targetRating }),
      })

      if (!response.ok) {
        // Revert on error
        onRatingChange?.(previousRating)
        toast.error(t('saveFailed'))
      }
    } catch {
      onRatingChange?.(previousRating)
      toast.error(t('saveFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => handleRate('up')}
        disabled={isSubmitting}
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors',
          rating === 'up'
            ? 'bg-success-muted text-success'
            : 'text-muted-foreground hover:bg-muted',
        )}
        aria-label={t('thumbsUp')}
        aria-pressed={rating === 'up'}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => handleRate('down')}
        disabled={isSubmitting}
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors',
          rating === 'down'
            ? 'bg-destructive/10 text-destructive'
            : 'text-muted-foreground hover:bg-muted',
        )}
        aria-label={t('thumbsDown')}
        aria-pressed={rating === 'down'}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
