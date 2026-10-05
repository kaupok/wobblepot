'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, SkipForward, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealRatingInline } from '@/components/meal-plan/MealRating'
import { PantryDeductionModal } from '@/components/meal-plan/PantryDeductionModal'
import { useEntryStatus } from '@/components/meal-plan/use-entry-status'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type {
  EntryRating,
  MealData,
  MealStatus,
  PantryItemFull,
} from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

interface PastMealRowProps {
  entryId: string
  planId: string
  meal: MealData
  mealType: MealType
  status: MealStatus
  rating?: EntryRating | null
  householdServings: number
  servingOverride?: number | null
  /** The pantry was already charged for this entry — see `PlanEntry.pantryDeducted`. */
  pantryDeducted?: boolean
  pantryItems?: PantryItemFull[]
}

/**
 * One past meal on `/past-meals`, as a row in its day's `RowGroup`: the slot
 * and the name, then one-click Cooked and Skipped (HON-1018). The page's one
 * job is to clear a backlog, so the row carries no image, description or
 * badges, and opens nothing. Cooked runs the same completion as the planner
 * card (`useEntryStatus`): the pantry deduction preview unless the entry was
 * already charged. Once cooked, the thumbs sit inline; they are the prompt.
 */
export function PastMealRow({
  entryId,
  planId,
  meal,
  mealType,
  status: initialStatus,
  rating: initialRating,
  householdServings,
  servingOverride,
  pantryDeducted = false,
  pantryItems = [],
}: PastMealRowProps) {
  const t = useTranslations('pastMeals.row')
  const mealTypeLabel = useEnumLabel('MealType', mealType)
  const nameId = useId()
  const [rating, setRating] = useState<EntryRating | null>(initialRating ?? null)
  const {
    status,
    isUpdating,
    isDeductionModalOpen,
    setIsDeductionModalOpen,
    handleStatusChange,
    handleDeductionConfirm,
  } = useEntryStatus({
    planId,
    entryId,
    meal,
    initialStatus,
    pantryDeducted,
    source: 'past_meals',
  })

  // Each action swaps the control that was pressed for another: Cooked and
  // Skipped give way to Undo, and Undo to Cooked, so focus would fall to the
  // page body (CLAUDE.md → Focus management). Exactly one of the two is
  // mounted, so it is the target whichever way the status moved, a revert
  // after a failed request included. The buttons are keyed: Skipped and Undo
  // sit in the same place, and React would otherwise reuse one's node for the
  // other, focus and all.
  const cookedRef = useRef<HTMLButtonElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const actedRef = useRef(false)
  function focusCurrentControl() {
    ;(undoRef.current ?? cookedRef.current)?.focus()
  }
  useEffect(() => {
    if (!actedRef.current) return
    // Only when focus was lost: the user may have moved on by the time the
    // request returns, and the deduction dialog holds focus while it is open.
    if (document.activeElement && document.activeElement !== document.body) return
    focusCurrentControl()
  }, [status])

  // A pending request keeps the buttons focusable (`aria-disabled`) and the
  // handler ignores the press: a `disabled` button drops focus.
  function act(next: MealStatus) {
    if (isUpdating) return
    actedRef.current = true
    handleStatusChange(next)
  }

  // The dialog opens from state, with no trigger to return to. After a
  // confirm Cooked is gone and Undo has taken its place; after a cancel
  // Cooked is still there.
  function focusRowOnClose(event: Event) {
    event.preventDefault()
    focusCurrentControl()
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <Body variant="caption">{mealTypeLabel}</Body>
          <Body id={nameId}>{meal.name}</Body>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === 'planned' ? (
            <>
              <Button
                key="cooked"
                ref={cookedRef}
                variant="outline"
                aria-describedby={nameId}
                aria-disabled={isUpdating || undefined}
                onClick={() => act('completed')}
              >
                <Check aria-hidden="true" />
                {t('cooked')}
              </Button>
              <Button
                key="skipped"
                variant="outline"
                aria-describedby={nameId}
                aria-disabled={isUpdating || undefined}
                onClick={() => act('skipped')}
              >
                <SkipForward aria-hidden="true" />
                {t('skipped')}
              </Button>
            </>
          ) : (
            <>
              {status === 'completed' ? (
                <>
                  <div className="text-success flex items-center gap-1.5">
                    <Check aria-hidden="true" className="size-4" />
                    <Body variant="small" tone="success">
                      {t('cooked')}
                    </Body>
                  </div>
                  <MealRatingInline
                    planId={planId}
                    entryId={entryId}
                    rating={rating}
                    onRatingChange={setRating}
                  />
                </>
              ) : (
                <div className="text-warning flex items-center gap-1.5">
                  <SkipForward aria-hidden="true" className="size-4" />
                  <Body variant="small" tone="warning">
                    {t('skipped')}
                  </Body>
                </div>
              )}
              <Button
                key="undo"
                ref={undoRef}
                variant="ghost"
                size="icon"
                aria-label={t('undo', { mealName: meal.name })}
                aria-disabled={isUpdating || undefined}
                onClick={() => act('planned')}
              >
                <Undo2 aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>
      <PantryDeductionModal
        open={isDeductionModalOpen}
        onOpenChange={setIsDeductionModalOpen}
        mealName={meal.name}
        components={meal.components}
        householdServings={servingOverride ?? householdServings}
        pantryItems={pantryItems}
        onConfirm={handleDeductionConfirm}
        isLoading={isUpdating}
        onCloseAutoFocus={focusRowOnClose}
      />
    </>
  )
}
