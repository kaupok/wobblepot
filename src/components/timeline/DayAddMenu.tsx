'use client'

import { Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react'

import { type AddMealChoice, MEAL_ROUTES } from '@/components/meal-plan/AddMealMenu'
import type { PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MealType } from '@/generated/prisma/enums'
import { useEnumLabel } from '@/lib/i18n/enum-label'

import { AddExtra } from './day-extras/AddExtra'
import {
  EmptySlotController,
  type EmptySlotHandle,
  type EmptySlotPending,
  type LogMode,
} from './EmptySlotController'

interface DayAddMenuProps {
  planId: string
  date: string
  /** The day as its heading reads it, e.g. "Saturday Oct 3" or "Tomorrow". */
  dayLabel: string
  /** Set on Today and Tomorrow, whose selector title says the word rather than the date. */
  relativeDay?: 'today' | 'tomorrow'
  /** The day's empty slots, in slot order. */
  emptySlots: MealType[]
  householdServings: number
  pantryIngredients?: PantryIngredient[]
  /** The pantry the fridge-meal picker searches (HON-1277). */
  pantryItems?: PantryItemFull[]
  /**
   * The day's one add button: "+ Add", or "+ Extra" on a day with no empty
   * slot. The day card passes it to focus the button after an extra is
   * removed.
   */
  buttonRef?: RefObject<HTMLButtonElement | null>
  /**
   * A meal in this slot was just cleared, and focus fell to the page body with
   * its card. The button takes focus once the slot is empty (HON-1123).
   */
  focusSlot?: MealType
  /** Called once the menu has acted on `focusSlot`, so the page can drop it. */
  onSlotFocused?: () => void
  /** "Pick for me" placed a meal, or a fridge meal was saved (HON-1248). */
  onPicked?: () => void
  /**
   * Set on Past meals (HON-1383): a log of a meal already eaten. The menu
   * offers a recipe or a fridge meal only, saved as cooked; Pick for me,
   * Generate and Extra are for a day still to come.
   */
  log?: Omit<LogMode, 'dayLabel'>
  /** The id of the text that says which slot the button fills, for `aria-describedby`. */
  describedBy?: string
}

/** The routes a log offers: the household names what it ate. */
const LOG_ROUTES = MEAL_ROUTES.filter(({ choice }) => choice === 'library' || choice === 'fridge')

/**
 * The day heading's one add control (HON-1335): a "+ Add" menu with the routes
 * for each empty slot and "Extra" last. With two or more empty slots, each
 * slot is a submenu of its routes (HON-1341): a flat list of every slot's
 * routes ran to 16 rows and scrolled. A submenu opens on a tap and from the
 * keyboard, not only on hover. With one empty slot the routes sit flat under
 * its label, so a half-planned day stays two taps away. A day with no empty
 * slot shows the "+ Extra" button alone, not a one-item menu.
 */
export function DayAddMenu({
  planId,
  date,
  dayLabel,
  relativeDay,
  emptySlots,
  householdServings,
  pantryIngredients,
  pantryItems,
  buttonRef: passedButtonRef,
  focusSlot,
  onSlotFocused,
  onPicked,
  log,
  describedBy,
}: DayAddMenuProps) {
  const tCard = useTranslations('meal-plan.card')
  const tExtras = useTranslations('meal-plan.extras')
  const [open, setOpen] = useState(false)
  const [isExtraOpen, setIsExtraOpen] = useState(false)
  // "Extra" was chosen: its dialog opens once the menu has closed. Opened in
  // the same tick, the closing menu takes focus back out of the dialog and
  // drops it on the body.
  const isOpeningExtraRef = useRef(false)
  const [pending, setPending] = useState<Partial<Record<MealType, EmptySlotPending>>>({})
  const controllers = useRef(new Map<MealType, EmptySlotHandle>())
  const ownButtonRef = useRef<HTMLButtonElement>(null)
  const buttonRef = passedButtonRef ?? ownButtonRef

  const handlePendingChange = useCallback(
    (mealType: MealType, next: EmptySlotPending) =>
      setPending((current) => {
        const previous = current[mealType]
        if (previous?.isAdding === next.isAdding && previous?.isPending === next.isPending) {
          return current
        }
        return { ...current, [mealType]: next }
      }),
    [],
  )
  const slotPending = emptySlots.map((mealType) => pending[mealType])
  const isAdding = slotPending.some((p) => p?.isAdding)
  // No second placeholder while the last one is still being created or deleted.
  const isPending = slotPending.some((p) => p?.isPending)

  // Waits for the cleared slot to show as empty: before the refresh lands the
  // card is still on the page, and focus is not yet on the body.
  const shouldFocus = focusSlot !== undefined && emptySlots.includes(focusSlot)
  useEffect(() => {
    if (!shouldFocus) return
    // Only from the body: a user who moved on before the refresh landed keeps
    // their place.
    if (!document.activeElement || document.activeElement === document.body) {
      buttonRef.current?.focus()
    }
    onSlotFocused?.()
  }, [shouldFocus, onSlotFocused, buttonRef])

  if (emptySlots.length === 0) {
    return <AddExtra date={date} dayLabel={dayLabel} buttonRef={buttonRef} />
  }

  const routes = log ? LOG_ROUTES : MEAL_ROUTES
  // The only empty slot shows flat; two or more each get a submenu (HON-1341).
  const onlySlot = emptySlots.length === 1 ? emptySlots[0] : undefined

  function choose(mealType: MealType, choice: AddMealChoice) {
    controllers.current.get(mealType)?.choose(choice)
  }

  // "Add" is the visible text and starts the name, which adds the day, so a
  // voice user can still say it (WCAG 2.5.3). The day follows a separator in
  // Estonian, so it needs no declension (HON-807).
  const buttonText = isAdding ? tCard('adding') : tCard('addToDay')
  const accessibleName = isAdding
    ? tCard('addingToDayLabel', { day: dayLabel })
    : tCard('addToDayLabel', { day: dayLabel })

  return (
    <>
      {/* Not modal, as the card's ⋯ menu: an item opens a modal dialog, and a
          modal menu closing under it can leave the body without pointer
          events. */}
      <DropdownMenu
        modal={false}
        open={open && !isPending}
        onOpenChange={(next) => setOpen(next && !isPending)}
      >
        <DropdownMenuTrigger asChild>
          {/* On a Past meals row, Add sits beside the rows' Cooked and Skipped,
              so it takes their size and the touch floor (HON-1383). */}
          <Button
            ref={buttonRef}
            variant={log ? 'outline' : 'ghost'}
            size={log ? 'default' : 'sm'}
            // Not `disabled`: a disabled button drops focus and cannot take it
            // back when the selector closes (HON-803).
            aria-disabled={isPending || undefined}
            aria-label={accessibleName}
            aria-describedby={describedBy}
          >
            <Plus aria-hidden="true" />
            {buttonText}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (!isOpeningExtraRef.current) return
            isOpeningExtraRef.current = false
            event.preventDefault()
            setIsExtraOpen(true)
          }}
        >
          {onlySlot ? (
            <SlotGroup
              mealType={onlySlot}
              routes={routes}
              onChoose={(choice) => choose(onlySlot, choice)}
            />
          ) : (
            emptySlots.map((mealType) => (
              <SlotSubmenu
                key={mealType}
                mealType={mealType}
                routes={routes}
                onChoose={(choice) => choose(mealType, choice)}
              />
            ))
          )}
          {!log && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  isOpeningExtraRef.current = true
                }}
              >
                <Plus aria-hidden="true" />
                {tExtras('button')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {emptySlots.map((mealType) => (
        <EmptySlotController
          key={mealType}
          ref={(handle) => {
            if (!handle) return
            controllers.current.set(mealType, handle)
            return () => {
              controllers.current.delete(mealType)
            }
          }}
          planId={planId}
          date={date}
          relativeDay={relativeDay}
          mealType={mealType}
          householdServings={householdServings}
          pantryIngredients={pantryIngredients}
          pantryItems={pantryItems}
          returnFocusRef={buttonRef}
          onPendingChange={handlePendingChange}
          onPicked={onPicked}
          log={log && { ...log, dayLabel }}
        />
      ))}
      {!log && (
        <AddExtra
          date={date}
          dayLabel={dayLabel}
          controlled={{
            open: isExtraOpen,
            onOpenChange: setIsExtraOpen,
            returnFocusRef: buttonRef,
          }}
        />
      )}
    </>
  )
}

interface SlotRoutesProps {
  mealType: MealType
  routes: typeof MEAL_ROUTES
  onChoose: (choice: AddMealChoice) => void
}

/** The routes to a meal, in the Swap group's order and words. */
function SlotRoutes({ routes, onChoose }: Pick<SlotRoutesProps, 'routes' | 'onChoose'>) {
  const tCard = useTranslations('meal-plan.card')
  return routes.map(({ choice, label, Icon }) => (
    <DropdownMenuItem key={choice} onSelect={() => onChoose(choice)}>
      <Icon aria-hidden="true" />
      {tCard(label)}
    </DropdownMenuItem>
  ))
}

/** The only empty slot's routes, flat under its meal type. */
function SlotGroup({ mealType, routes, onChoose }: SlotRoutesProps) {
  const mealTypeLabel = useEnumLabel('MealType', mealType)
  const labelId = useId()

  return (
    <DropdownMenuGroup aria-labelledby={labelId}>
      <DropdownMenuLabel id={labelId}>{mealTypeLabel}</DropdownMenuLabel>
      <SlotRoutes routes={routes} onChoose={onChoose} />
    </DropdownMenuGroup>
  )
}

/** One of several empty slots: its meal type, opening a submenu of its routes. */
function SlotSubmenu({ mealType, routes, onChoose }: SlotRoutesProps) {
  const mealTypeLabel = useEnumLabel('MealType', mealType)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{mealTypeLabel}</DropdownMenuSubTrigger>
      {/* Portalled, so the parent menu's scroll box cannot clip it. */}
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          <SlotRoutes routes={routes} onChoose={onChoose} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
