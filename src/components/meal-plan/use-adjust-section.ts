'use client'

import { useCallback, useRef, useState, type RefObject } from 'react'
import { scrollIntoViewNearest } from '@/lib/utils'
import type { AdjustRecipeProps } from './AdjustRecipe'

/**
 * Whether the cook view shows the "Adjust recipe" section (HON-1356). It opens
 * under the ingredients only from the title row's ⋯ menu, and closes with the
 * view, so every open starts without it.
 */
export function useAdjustSection({
  viewOpen,
  triggerRef,
}: {
  /** The cook view is open. `MealCard` keeps it mounted while closed. */
  viewOpen: boolean
  /** The ⋯ trigger, where focus goes when the section closes. */
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const [open, setOpen] = useState(false)
  if (!viewOpen && open) setOpen(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  // Set when the menu item is chosen, read once as the menu closes.
  const requestedRef = useRef(false)
  // The section's field unmounts as it closes, so focus goes to the ⋯ trigger.
  const onClose = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [triggerRef])

  return {
    /** The ⋯ menu's "Adjust recipe" was chosen. */
    request: () => {
      requestedRef.current = true
      setOpen(true)
    },
    /**
     * As the menu closes: focus the field and bring the section into view,
     * its button too, when the item was chosen. True when it took focus, so
     * the menu must not.
     */
    takeMenuFocus: () => {
      if (!requestedRef.current) return false
      requestedRef.current = false
      const field = fieldRef.current
      field?.focus({ preventScroll: true })
      scrollIntoViewNearest(field?.form ?? field)
      return true
    },
    controls: { open, onClose, fieldRef } satisfies Pick<
      AdjustRecipeProps,
      'open' | 'onClose' | 'fieldRef'
    >,
  }
}
