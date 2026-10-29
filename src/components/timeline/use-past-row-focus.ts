'use client'

import { useCallback, useEffect, useRef } from 'react'

import type { MealStatus } from '@/components/meal-plan/types'

interface UsePastRowFocusOptions {
  status: MealStatus
  /**
   * The row just replaced an empty slot the household logged into, and focus
   * fell to the page body with the slot's Add button (HON-1383).
   */
  autoFocus?: boolean
  /** Called once the row has acted on `autoFocus`, so the list can drop it. */
  onFocused?: () => void
}

/**
 * Focus for a row on Past meals. Each action swaps the control that was
 * pressed for another: Cooked and Skipped give way to Undo, and Undo to
 * Cooked, so focus would fall to the page body (docs/DESIGN.md → Focus
 * management). Exactly one of the two is mounted, so it is the target
 * whichever way the status moved, a revert after a failed request included.
 * Key the buttons: Skipped and Undo sit in the same place, and React would
 * otherwise reuse one's node for the other, focus and all.
 */
export function usePastRowFocus({ status, autoFocus = false, onFocused }: UsePastRowFocusOptions) {
  const cookedRef = useRef<HTMLButtonElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const actedRef = useRef(false)

  const focusCurrentControl = useCallback(() => {
    ;(undoRef.current ?? cookedRef.current)?.focus()
  }, [])

  useEffect(() => {
    if (!actedRef.current) return
    // Only when focus was lost: the user may have moved on by the time the
    // request returns, and a dialog holds focus while it is open.
    if (document.activeElement && document.activeElement !== document.body) return
    focusCurrentControl()
  }, [status, focusCurrentControl])

  useEffect(() => {
    if (!autoFocus) return
    // Only from the body: a user who moved on before the refresh landed keeps
    // their place.
    if (!document.activeElement || document.activeElement === document.body) {
      focusCurrentControl()
    }
    onFocused?.()
  }, [autoFocus, onFocused, focusCurrentControl])

  // The dialogs open from state, with no trigger to return to. After a
  // confirm Cooked is gone and Undo has taken its place; after a cancel
  // Cooked is still there.
  function focusRowOnClose(event: Event) {
    event.preventDefault()
    focusCurrentControl()
  }

  return {
    cookedRef,
    undoRef,
    /** Call before a status change, so the row restores focus when it lands. */
    markActed: () => {
      actedRef.current = true
    },
    focusRowOnClose,
  }
}
