'use client'

import { useRef, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { Check, MoreHorizontal, NotebookPen, Repeat, SkipForward, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MealStatus } from './types'

interface MealCardMenuProps {
  mealName: string
  status: MealStatus
  /** The ⋯ trigger: the card returns focus here when a dialog the menu opened closes. */
  triggerRef: RefObject<HTMLButtonElement | null>
  isUpdating: boolean
  isClearing: boolean
  /** Opens the note editor. */
  onNote: () => void
  /** Focuses the note editor's textarea, once the menu has closed. */
  focusNote: () => void
  onComplete: () => void
  onStatusChange: (status: 'planned' | 'skipped') => void
  onSwap: () => void
  onClear: () => void
}

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
  onNote,
  focusNote,
  onComplete,
  onStatusChange,
  onSwap,
  onClear,
}: MealCardMenuProps) {
  const tCard = useTranslations('meal-plan.card')
  // Set when Note is chosen, read once as the menu closes.
  const noteRequestedRef = useRef(false)

  // A completed entry records what was cooked and what the pantry was charged
  // for, so the API refuses to repoint it (409, HON-633) — offering Swap here
  // would only produce an error. Skipped entries stay swappable: nothing was
  // charged for them, and "actually, let's cook something" is a real path.
  const canSwapMeal = status !== 'completed'

  return (
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
        {canSwapMeal && (
          <DropdownMenuItem onSelect={onSwap}>
            <Repeat aria-hidden="true" />
            {tCard('swap')}
          </DropdownMenuItem>
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
  )
}
