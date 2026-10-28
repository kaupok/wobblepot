'use client'

import { useId } from 'react'
import { Body } from '@/components/ui/typography'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { PantryItemFull } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'
import { DayAddMenu } from './DayAddMenu'
import type { LogMode } from './EmptySlotController'

interface PastEmptyRowProps {
  planId: string
  date: string
  /** The day as its heading reads it, e.g. "Tuesday Apr 14". */
  dayLabel: string
  mealType: MealType
  householdServings: number
  pantryItems: PantryItemFull[]
  log: Omit<LogMode, 'dayLabel'>
  /** Remove just cleared this slot: its Add button takes focus (HON-1123). */
  autoFocus?: boolean
  onFocused?: () => void
  /** A meal was logged here. The row that replaces this one takes focus. */
  onLogged: () => void
}

/**
 * A past slot the household expects a meal in, with nothing in it
 * (HON-1383): the meal type, then Add, which logs what the household ate as
 * a recipe or a fridge meal. Parents who miss an evening fill it in the next
 * morning, so the row is as short as the others in its day.
 */
export function PastEmptyRow({
  planId,
  date,
  dayLabel,
  mealType,
  householdServings,
  pantryItems,
  log,
  autoFocus,
  onFocused,
  onLogged,
}: PastEmptyRowProps) {
  const mealTypeLabel = useEnumLabel('MealType', mealType)
  const labelId = useId()

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
      <Body id={labelId} tone="muted">
        {mealTypeLabel}
      </Body>
      <DayAddMenu
        planId={planId}
        date={date}
        dayLabel={dayLabel}
        emptySlots={[mealType]}
        householdServings={householdServings}
        pantryItems={pantryItems}
        log={log}
        describedBy={labelId}
        focusSlot={autoFocus ? mealType : undefined}
        onSlotFocused={onFocused}
        onPicked={onLogged}
      />
    </div>
  )
}
