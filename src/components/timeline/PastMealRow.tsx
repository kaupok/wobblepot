'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, SkipForward, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealRatingInline } from '@/components/meal-plan/MealRating'
import { PantryDeductionModal } from '@/components/meal-plan/PantryDeductionModal'
import { useEntryStatus } from '@/components/meal-plan/use-entry-status'
import { useClearEntry } from '@/components/meal-plan/use-clear-entry'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type {
  EntryRating,
  MealData,
  MealStatus,
  PantryItemFull,
} from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'
import { usePastRowFocus } from './use-past-row-focus'

interface PastMealRowProps {
  entryId: string
  planId: string
  date: string
  note?: string | null
  noteX?: number | null
  noteY?: number | null
  meal: MealData
  mealType: MealType
  status: MealStatus
  rating?: EntryRating | null
  householdServings: number
  servingOverride?: number | null
  /** The pantry was already charged for this entry — see `PlanEntry.pantryDeducted`. */
  pantryDeducted?: boolean
  pantryItems?: PantryItemFull[]
  /** Focus the row's control once it mounts — see `usePastRowFocus`. */
  autoFocus?: boolean
  onFocused?: () => void
  /** Remove deleted the entry; the list moves focus to the empty slot that replaces it. */
  onCleared?: () => void
}

/**
 * One past meal on `/past-meals`, as a row in its day's `RowGroup`: the slot
 * and the name, then one-click Cooked and Skipped (HON-1018). The page's one
 * job is to clear a backlog, so the row carries no image, description or
 * badges, and opens nothing. Cooked runs the same completion as the planner
 * card (`useEntryStatus`): the pantry deduction preview, unless the entry was
 * already charged or its meal would change no pantry row. Once cooked, the
 * thumbs sit inline; they are the prompt. A row that is not cooked also has
 * Remove, which clears the slot as Clear does on the planner card, so a wrong
 * log is fixed with Undo, then Remove (HON-1383). A cooked row has none:
 * nothing tells a logged meal from a planned one cooked later.
 */
export function PastMealRow({
  entryId,
  planId,
  date,
  note = null,
  noteX = null,
  noteY = null,
  meal,
  mealType,
  status: initialStatus,
  rating: initialRating,
  householdServings,
  servingOverride,
  pantryDeducted = false,
  pantryItems = [],
  autoFocus,
  onFocused,
  onCleared,
}: PastMealRowProps) {
  const t = useTranslations('pastMeals.row')
  const mealTypeLabel = useEnumLabel('MealType', mealType)
  const nameId = useId()
  const [rating, setRating] = useState<EntryRating | null>(initialRating ?? null)
  const servings = servingOverride ?? householdServings
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
    servings,
    pantryItems,
    source: 'past_meals',
  })

  const { cookedRef, undoRef, markActed, focusRowOnClose } = usePastRowFocus({
    status,
    autoFocus,
    onFocused,
  })
  const { clear, isClearing } = useClearEntry({ planId, entryId, name: meal.name, onCleared })
  const isBusy = isUpdating || isClearing

  // A pending request keeps the buttons focusable (`aria-disabled`) and the
  // handler ignores the press: a `disabled` button drops focus.
  function act(next: MealStatus) {
    if (isBusy) return
    markActed()
    handleStatusChange(next)
  }

  function remove() {
    if (isBusy || status === 'completed') return
    clear({
      date,
      mealType,
      mealId: meal.id,
      note,
      noteX: note ? noteX : null,
      noteY: note ? noteY : null,
      servingOverride: servingOverride ?? null,
      status,
      rating,
      pantryDeducted,
    })
  }

  const removeButton = (
    <Button
      key="remove"
      variant="ghost"
      aria-describedby={nameId}
      aria-disabled={isBusy || undefined}
      onClick={remove}
    >
      <Trash2 aria-hidden="true" />
      {t('remove')}
    </Button>
  )

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
                aria-disabled={isBusy || undefined}
                onClick={() => act('completed')}
              >
                <Check aria-hidden="true" />
                {t('cooked')}
              </Button>
              <Button
                key="skipped"
                variant="outline"
                aria-describedby={nameId}
                aria-disabled={isBusy || undefined}
                onClick={() => act('skipped')}
              >
                <SkipForward aria-hidden="true" />
                {t('skipped')}
              </Button>
              {removeButton}
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
                aria-disabled={isBusy || undefined}
                onClick={() => act('planned')}
              >
                <Undo2 aria-hidden="true" />
              </Button>
              {status === 'skipped' && removeButton}
            </>
          )}
        </div>
      </div>
      <PantryDeductionModal
        open={isDeductionModalOpen}
        onOpenChange={setIsDeductionModalOpen}
        mealName={meal.name}
        components={meal.components}
        householdServings={servings}
        pantryItems={pantryItems}
        onConfirm={handleDeductionConfirm}
        isLoading={isUpdating}
        onCloseAutoFocus={focusRowOnClose}
      />
    </>
  )
}
