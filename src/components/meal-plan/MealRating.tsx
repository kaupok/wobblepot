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

  // The thumbs are an aria-pressed toggle pair, not two buttons: round, and
  // tinted with the rating's own meaning while pressed. `Button` has no pressed
  // state and there is no `Toggle` primitive yet, so the pressed treatment lives
  // here — the one deliberate `no-restyle` exception (HON-674).
  /* eslint-disable shadcn/no-restyle -- pressed-state tint of a toggle pair; see above */
  return (
    <div className="flex items-center gap-1">
      <Button
        variant={rating === 'up' ? 'ghost' : 'quiet'}
        size="icon-sm"
        onClick={() => handleRate('up')}
        disabled={isSubmitting}
        className={cn('rounded-full', rating === 'up' && 'bg-success-muted text-success')}
        aria-label={t('thumbsUp')}
        aria-pressed={rating === 'up'}
      >
        <ThumbsUp className="size-4" />
      </Button>
      <Button
        variant={rating === 'down' ? 'ghost' : 'quiet'}
        size="icon-sm"
        onClick={() => handleRate('down')}
        disabled={isSubmitting}
        className={cn('rounded-full', rating === 'down' && 'bg-destructive/10 text-destructive')}
        aria-label={t('thumbsDown')}
        aria-pressed={rating === 'down'}
      >
        <ThumbsDown className="size-4" />
      </Button>
    </div>
  )
  /* eslint-enable shadcn/no-restyle */
}
