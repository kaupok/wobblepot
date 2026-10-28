import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'

export type PantryChange = 'removed' | 'restored'

/**
 * Applies pantry removals and Undos from the parent to the shopping list's
 * ticks. A removal unticks the item; an Undo ticks it again only if that
 * removal unticked it, so the list returns to its state before (HON-1355).
 */
export function usePantryChanges(
  changes: Map<string, PantryChange> | undefined,
  onProcessed: (() => void) | undefined,
  setPurchasedIds: Dispatch<SetStateAction<Set<string>>>,
) {
  // Ingredients a pantry removal unticked, so an Undo knows which to tick again.
  const untickedByRemoval = useRef(new Set<string>())

  useEffect(() => {
    if (!changes || changes.size === 0) return

    // React may run the updater twice, so each step gives the same result when
    // repeated.
    setPurchasedIds((prev) => {
      const next = new Set(prev)
      changes.forEach((change, id) => {
        if (change === 'restored') {
          if (untickedByRemoval.current.has(id)) next.add(id)
        } else if (prev.has(id)) {
          untickedByRemoval.current.add(id)
          next.delete(id)
        } else {
          untickedByRemoval.current.delete(id)
        }
      })
      return next
    })

    // Clear the parent's map after processing to prevent stale reruns
    onProcessed?.()
  }, [changes, onProcessed, setPurchasedIds])
}
