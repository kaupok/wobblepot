'use client'

import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Body } from '@/components/ui/typography'
import { ApiError, apiFetch } from '@/lib/api'

import { LeftoverServingsControl } from './fridge-meal/LeftoverServingsControl'

/** The refusals `POST …/leftover-lunch` answers with a `code`, as keys under `meal-plan.cookForLunch.errors`. */
const ERROR_KEYS = [
  'recipeLunch',
  'cooked',
  'alreadyLinked',
  'lunchFull',
  'notPlannedDinner',
  'lunchChanged',
] as const

interface CookForLunchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  /** The planned recipe dinner the lunch takes leftovers from. */
  entryId: string
  mealName: string
  /** The household's own servings, where the control starts. */
  householdServings: number
  /** Opened from the card's ⋯ menu, so the card returns focus to it (docs/DESIGN.md → Focus management). */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * "Cook for tomorrow's lunch too" (HON-1396): how many servings of tonight's
 * dinner become the next day's lunch. Confirm adds one leftover item for this
 * dinner to that lunch, as the fridge-meal picker would, and the dinner then
 * cooks that much more.
 */
export function CookForLunchDialog({
  open,
  onOpenChange,
  planId,
  entryId,
  mealName,
  householdServings,
  onCloseAutoFocus,
}: CookForLunchDialogProps) {
  const t = useTranslations('meal-plan.cookForLunch')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [servings, setServings] = useState(householdServings)

  // A reopened dialog starts from the household's servings.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setServings(householdServings)
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/meal-plans/${planId}/entries/${entryId}/leftover-lunch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servings }),
      }),
    onSuccess: () => {
      toast.success(t('added', { meal: mealName }))
      onOpenChange(false)
      // The planner reads its entries from the server render.
      router.refresh()
    },
    // Never `error.message`: it is the route's English `error` (CLAUDE.md →
    // Localization). The `code` picks the catalog copy.
    onError: (error) => {
      const code = error instanceof ApiError ? error.code : undefined
      const key = ERROR_KEYS.find((known) => known === code) ?? 'failed'
      console.error('[cook-for-lunch] request failed', {
        status: error instanceof ApiError ? error.status : undefined,
        code,
      })
      toast.error(t(`errors.${key}`))
    },
  })
  const isSaving = mutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { meal: mealName })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <Body variant="small">{t('servingsLabel')}</Body>
          <LeftoverServingsControl
            value={servings}
            onChange={setServings}
            defaultServings={householdServings}
            label={t('servingsLabel')}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          {/* Not `disabled`: a disabled button drops focus (HON-803). */}
          <Button
            onClick={() => !isSaving && mutation.mutate()}
            aria-disabled={isSaving || undefined}
          >
            {isSaving ? t('saving') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
