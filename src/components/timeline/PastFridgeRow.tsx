'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import { Check, SkipForward, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { FridgeCompleteDialog } from '@/components/meal-plan/fridge-meal/FridgeCompleteDialog'
import {
  toFridgeItemInput,
  useFridgeItemText,
} from '@/components/meal-plan/fridge-meal/use-fridge-item-text'
import { useEntryStatus } from '@/components/meal-plan/use-entry-status'
import { useClearEntry } from '@/components/meal-plan/use-clear-entry'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { FridgeMealItem, MealStatus, PantryItemFull } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'
import { usePastRowFocus } from './use-past-row-focus'

interface PastFridgeRowProps {
  entryId: string
  planId: string
  date: string
  mealType: MealType
  items: FridgeMealItem[]
  status: MealStatus
  note?: string | null
  noteX?: number | null
  noteY?: number | null
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
 * One past fridge meal on `/past-meals` (HON-1383), as a row like
 * `PastMealRow`: the slot, the items as its name, then Cooked, Skipped and
 * Remove. Cooked completes it as "Eaten" does on the Today card: the "Used it
 * all" dialog when an item is from the pantry, unless the pantry was already
 * marked. A fridge meal has no recipe to rate, so a cooked row shows no
 * thumbs.
 */
export function PastFridgeRow({
  entryId,
  planId,
  date,
  mealType,
  items,
  status: initialStatus,
  note = null,
  noteX = null,
  noteY = null,
  pantryDeducted = false,
  pantryItems = [],
  autoFocus,
  onFocused,
  onCleared,
}: PastFridgeRowProps) {
  const t = useTranslations('pastMeals.row')
  const tFridge = useTranslations('meal-plan.fridge')
  const mealTypeLabel = useEnumLabel('MealType', mealType)
  const itemText = useFridgeItemText()
  const nameId = useId()
  const name = items.map(itemText).join(', ')
  const {
    status,
    isPantryCharged,
    isUpdating,
    isDeductionModalOpen: isCompleteOpen,
    setIsDeductionModalOpen: setIsCompleteOpen,
    handleStatusChange,
    completeFridgeMeal,
  } = useEntryStatus({
    planId,
    entryId,
    meal: null,
    initialStatus,
    pantryDeducted,
    servings: 0,
    pantryItems,
    source: 'past_meals',
  })
  const { cookedRef, undoRef, markActed, focusRowOnClose } = usePastRowFocus({
    status,
    autoFocus,
    onFocused,
  })
  // The toast names the title and the items, as the Today card's does.
  const { clear, isClearing } = useClearEntry({
    planId,
    entryId,
    name: tFridge('cardName', { title: tFridge('title'), items: name }),
    onCleared,
  })
  const isBusy = isUpdating || isClearing
  const hasPantryItems = items.some((item) => item.ingredientId !== null)

  // A pending request keeps the buttons focusable (`aria-disabled`) and the
  // handler ignores the press: a `disabled` button drops focus.
  function act(next: MealStatus) {
    if (isBusy) return
    markActed()
    // Nothing to tick, or the pantry was marked once already (HON-651): the
    // dialog would offer a change the server would not make.
    if (next === 'completed' && hasPantryItems && !isPantryCharged) {
      setIsCompleteOpen(true)
      return
    }
    handleStatusChange(next)
  }

  function remove() {
    if (isBusy || status === 'completed') return
    clear({
      date,
      mealType,
      fridgeItems: items.map(toFridgeItemInput),
      status,
      note,
      noteX: note ? noteX : null,
      noteY: note ? noteY : null,
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
          <Body variant="caption">
            {mealTypeLabel}, {tFridge('title')}
          </Body>
          <Body id={nameId}>{name}</Body>
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
                <div className="text-success flex items-center gap-1.5">
                  <Check aria-hidden="true" className="size-4" />
                  <Body variant="small" tone="success">
                    {t('cooked')}
                  </Body>
                </div>
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
                aria-label={t('undo', { mealName: name })}
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
      <FridgeCompleteDialog
        open={isCompleteOpen}
        onOpenChange={setIsCompleteOpen}
        items={items}
        onConfirm={(ids) => completeFridgeMeal(ids, () => setIsCompleteOpen(false))}
        isLoading={isUpdating}
        onCloseAutoFocus={focusRowOnClose}
      />
    </>
  )
}
