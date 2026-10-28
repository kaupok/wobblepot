import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'

export type PantryChange = 'removed' | 'restored'

/**
 * Applies pantry removals and Undos from the parent to the shopping list's
 * ticks. A removal unticks the item; an Undo ticks it again only if that
 * removal unticked it, so the list returns to its state before (HON-1355).
 *
 * `onProcessed(listStale)` says whether an Undo needs the list re-read. A
 * re-ticked item must not be re-read: the server drops a bought item from the
 * list, so the row the household saw ticked would go. Any other restored row
 * can cover a need again, which only the server can work out.
 */
export function usePantryChanges(
  changes: Map<string, PantryChange> | undefined,
  onProcessed: ((listStale: boolean) => void) | undefined,
  setPurchasedIds: Dispatch<SetStateAction<Set<string>>>,
) {
  // Ingredients a pantry removal unticked, so an Undo knows which to tick again.
  const untickedByRemoval = useRef(new Set<string>())

  useEffect(() => {
    if (!changes || changes.size === 0) return

    // Read before the updater below runs, which it does on the next render.
    const listStale = [...changes].some(
      ([id, change]) => change === 'restored' && !untickedByRemoval.current.has(id),
    )

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
    onProcessed?.(listStale)
  }, [changes, onProcessed, setPurchasedIds])
}
