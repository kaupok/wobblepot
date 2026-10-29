'use client'

import {
  Check,
  MoreHorizontal,
  NotebookPen,
  Refrigerator,
  SkipForward,
  Undo2,
  X,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type RefObject, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Body } from '@/components/ui/typography'

import { type AddMealChoice, MEAL_ROUTES } from './AddMealMenu'
import { CookForLunchDialog } from './CookForLunchDialog'
import type { LeftoverLunchOption } from './leftover-lunch-option'
import type { MealStatus } from './types'

interface MealCardMenuProps {
  mealName: string
  status: MealStatus
  /** The ⋯ trigger: the card returns focus here when a dialog the menu opened closes. */
  triggerRef: RefObject<HTMLButtonElement | null>
  isUpdating: boolean
  isClearing: boolean
  /** "Pick for me" is placing a meal: its item waits. */
  isPicking?: boolean
  /** Opens the note editor. */
  onNote: () => void
  /** Focuses the note editor's textarea, once the menu has closed. */
  focusNote: () => void
  onComplete: () => void
  onStatusChange: (status: 'planned' | 'skipped') => void
  /** A Swap route: a selector view, or `pick`, which places the top swap with no dialog. */
  onSwap: (choice: AddMealChoice) => void
  onClear: () => void
  /** "Cook for tomorrow's lunch too" on a planned recipe dinner (HON-1396); absent hides it. */
  cookForLunch?: {
    option: LeftoverLunchOption
    planId: string
    entryId: string
    householdServings: number
  }
}

const LEFTOVER_LUNCH_REASON_KEYS = {
  recipeLunch: 'reasonRecipeLunch',
  cooked: 'reasonCooked',
  lunchOff: 'reasonLunchOff',
} as const

/**
 * A planned card's ⋯ menu. Note, the status, Swap and Clear share one trigger,
 * so the title row keeps its width for the meal name.
 */
export function MealCardMenu({
  mealName,
  status,
  triggerRef,
  isUpdating,
  isClearing,
  isPicking = false,
  onNote,
  focusNote,
  onComplete,
  onStatusChange,
  onSwap,
  onClear,
  cookForLunch,
}: MealCardMenuProps) {
  const tCard = useTranslations('meal-plan.card')
  const tLunch = useTranslations('meal-plan.cookForLunch')
  // Set when Note is chosen, read once as the menu closes.
  const noteRequestedRef = useRef(false)
  const swapLabelId = useId()
  // The dialog lives here, not in the menu content, which unmounts as the
  // menu closes.
  const [isCookForLunchOpen, setIsCookForLunchOpen] = useState(false)
  const leftoverLunch = cookForLunch?.option

  // A completed entry records what was cooked and what the pantry was charged
  // for, so the API refuses to repoint it (409, HON-633) — offering the Swap
  // routes here would only produce an error. Skipped entries stay swappable:
  // nothing was charged for them, and "actually, let's cook something" is a
  // real path.
  const canSwapMeal = status !== 'completed'

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon-sm"
            aria-label={tCard('moreActions', { name: mealName })}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Radix returns focus to the trigger as the menu closes, after
          // `NoteEditor` has focused its textarea, and on a pointer pick it has
          // already pulled focus back into the closing menu by then (HON-946).
          // When Note was chosen, focus the textarea here instead: the menu's
          // unmount is the last thing to move focus.
          onCloseAutoFocus={(event) => {
            if (noteRequestedRef.current) {
              event.preventDefault()
              noteRequestedRef.current = false
              focusNote()
            }
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              noteRequestedRef.current = true
              onNote()
            }}
          >
            <NotebookPen aria-hidden="true" />
            {tCard('note')}
          </DropdownMenuItem>
          {/* Tonight's "not tonight", and a meal cooked without the cook view,
            take one pick here (HON-1125). */}
          {status === 'planned' && (
            <>
              <DropdownMenuItem onSelect={onComplete} disabled={isUpdating}>
                <Check aria-hidden="true" />
                {tCard('cooked')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onStatusChange('skipped')} disabled={isUpdating}>
                <SkipForward aria-hidden="true" />
                {tCard('skipped')}
              </DropdownMenuItem>
              {/* Shown when it cannot run too, with the reason, so the household
                learns what to change (HON-1396). `unavailable`, not `disabled`,
                so a keyboard user can arrow to it and hear the reason (HON-1426). */}
              {leftoverLunch && (
                <DropdownMenuItem
                  unavailable={leftoverLunch.state === 'unavailable'}
                  onSelect={(event) => {
                    if (leftoverLunch.state === 'unavailable') {
                      event.preventDefault()
                      return
                    }
                    setIsCookForLunchOpen(true)
                  }}
                >
                  <Refrigerator aria-hidden="true" />
                  <div className="flex flex-col gap-1">
                    <span>{tLunch('menuItem')}</span>
                    {leftoverLunch.state === 'unavailable' && (
                      <Body variant="caption">
                        {tLunch(LEFTOVER_LUNCH_REASON_KEYS[leftoverLunch.reason])}
                      </Body>
                    )}
                  </div>
                </DropdownMenuItem>
              )}
            </>
          )}
          {/* A completion or a skip on today's or a future day's meal needs its
            own way back here. Past meals have their own page (HON-1018). */}
          {status === 'completed' && (
            <DropdownMenuItem onSelect={() => onStatusChange('planned')} disabled={isUpdating}>
              <Undo2 aria-hidden="true" />
              {tCard('notCookedYet')}
            </DropdownMenuItem>
          )}
          {status === 'skipped' && (
            <DropdownMenuItem onSelect={() => onStatusChange('planned')} disabled={isUpdating}>
              <Undo2 aria-hidden="true" />
              {tCard('notSkipped')}
            </DropdownMenuItem>
          )}
          {/* The open slot's routes, in its words, so a household learns one
            set (HON-1249). Flat, not a submenu: each route stays one tap away
            on a phone. */}
          {canSwapMeal && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup aria-labelledby={swapLabelId}>
                <DropdownMenuLabel id={swapLabelId}>{tCard('swap')}</DropdownMenuLabel>
                {MEAL_ROUTES.map(({ choice, label, Icon }) => (
                  <DropdownMenuItem
                    key={choice}
                    onSelect={() => onSwap(choice)}
                    disabled={choice === 'pick' && isPicking}
                  >
                    <Icon aria-hidden="true" />
                    {tCard(label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          {/* A completed entry records what the pantry was charged for, and
            Undo cannot restore that; "Not cooked yet" is its way back
            (HON-1123). */}
          {status !== 'completed' && (
            <DropdownMenuItem onSelect={onClear} disabled={isClearing}>
              <X aria-hidden="true" />
              {tCard('clear')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {cookForLunch && (
        <CookForLunchDialog
          open={isCookForLunchOpen}
          onOpenChange={setIsCookForLunchOpen}
          planId={cookForLunch.planId}
          entryId={cookForLunch.entryId}
          mealName={mealName}
          householdServings={cookForLunch.householdServings}
          // Opened from state, so focus goes back to the ⋯ trigger.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
        />
      )}
    </>
  )
}
