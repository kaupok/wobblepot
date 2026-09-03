'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'

/**
 * User-added shopping-list rows, separate from the ones computed from the meal
 * plan. Every mutation updates local state first — a checkbox that lags behind a
 * round trip feels broken — and rolls that update back when the request fails,
 * so the list never contradicts its own error toast.
 */
export function useCustomShoppingItems(initialCustomItems: CustomItemData[]) {
  const tErrors = useTranslations('shopping.errors')
  const [customItems, setCustomItems] = useState<CustomItemData[]>(initialCustomItems)
  const [pendingCustomIds, setPendingCustomIds] = useState<Set<string>>(new Set())

  const handleCustomItemAdded = useCallback((item: CustomItemData) => {
    setCustomItems((prev) => [item, ...prev])
  }, [])

  const handleCustomToggle = useCallback(
    async (id: string, checked: boolean) => {
      if (pendingCustomIds.has(id)) return

      // Optimistic update
      setCustomItems((prev) => prev.map((item) => (item.id === id ? { ...item, checked } : item)))
      setPendingCustomIds((prev) => new Set(prev).add(id))

      try {
        const response = await fetch(`/api/shopping-list/custom/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || tErrors('updateFailed'))
        }
      } catch (error) {
        // Revert optimistic update
        setCustomItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, checked: !checked } : item)),
        )
        const message = error instanceof Error ? error.message : tErrors('updateFailed')
        toast.error(message)
      } finally {
        setPendingCustomIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [pendingCustomIds, tErrors],
  )

  const handleCustomUnlink = useCallback(
    async (id: string) => {
      const previous = customItems.find((item) => item.id === id)

      // Optimistic update
      setCustomItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, ingredientId: null, ingredientCategory: null } : item,
        ),
      )

      try {
        const response = await fetch(`/api/shopping-list/custom/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredientId: null }),
        })

        if (!response.ok) {
          throw new Error(tErrors('unlinkFailed'))
        }
      } catch {
        // Revert only the two fields we edited — the row may have been checked
        // while the request was in flight, and that toggle is not ours to undo.
        // A snapshot that is already unlinked belongs to a second click that
        // read the first one's optimistic state; restoring it would overwrite
        // the real link the first click is about to put back. There was nothing
        // to unlink in that case either, so skipping is also the honest revert.
        if (previous?.ingredientId != null) {
          setCustomItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    ingredientId: previous.ingredientId,
                    ingredientCategory: previous.ingredientCategory,
                  }
                : item,
            ),
          )
        }
        toast.error(tErrors('unlinkFailed'))
      }
    },
    [customItems, tErrors],
  )

  const handleCustomDelete = useCallback(
    async (id: string) => {
      const removedIndex = customItems.findIndex((item) => item.id === id)
      const removed = customItems[removedIndex]

      // Optimistic update
      setCustomItems((prev) => prev.filter((item) => item.id !== id))

      try {
        const response = await fetch(`/api/shopping-list/custom/${id}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          // The route answers 404 for two different things: the row is already
          // gone ('Item not found' — a delete that won a race, so putting the
          // row back would resurrect it on screen), or the session has no
          // household ('No household found'), where the row is still there and
          // the delete really did fail. Only the first is treated as done.
          const data = await response.json().catch(() => ({}))
          const alreadyGone = response.status === 404 && data.error === 'Item not found'

          if (!alreadyGone) {
            throw new Error(tErrors('removeFailed'))
          }
        }
      } catch {
        // Put the row back where it was — appending would silently reorder the
        // list. `splice` clamps a stale index to the end, and the presence check
        // keeps an un-debounced double-click from inserting the row twice.
        if (removed) {
          setCustomItems((prev) => {
            if (prev.some((item) => item.id === id)) return prev
            const next = [...prev]
            next.splice(removedIndex, 0, removed)
            return next
          })
        }
        toast.error(tErrors('removeFailed'))
      }
    },
    [customItems, tErrors],
  )

  const handleClearChecked = useCallback(async () => {
    const checkedIds = new Set(customItems.filter((i) => i.checked).map((i) => i.id))
    if (checkedIds.size === 0) return

    const previousItems = customItems

    // Optimistic update
    setCustomItems((prev) => prev.filter((item) => !item.checked))

    try {
      const response = await fetch('/api/shopping-list/custom/checked', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(tErrors('clearCheckedFailed'))
      }
    } catch {
      // Rebuild from the snapshot rather than assigning it. Only the rows this
      // request removed come back — `checkedIds` is exactly that set, so a row
      // dropped by a concurrent delete that succeeded stays gone instead of
      // being resurrected. A row edited while the request was in flight keeps
      // its current version, and a row added in that window stays at the head
      // where `handleCustomItemAdded` put it.
      setCustomItems((prev) => {
        const current = new Map(prev.map((item) => [item.id, item]))
        const snapshotIds = new Set(previousItems.map((item) => item.id))
        const added = prev.filter((item) => !snapshotIds.has(item.id))
        const restored = previousItems
          .filter((item) => current.has(item.id) || checkedIds.has(item.id))
          .map((item) => current.get(item.id) ?? item)
        return [...added, ...restored]
      })
      toast.error(tErrors('clearCheckedFailed'))
    }
  }, [customItems, tErrors])

  return {
    customItems,
    pendingCustomIds,
    checkedCustomCount: customItems.filter((i) => i.checked).length,
    uncheckedCustomCount: customItems.filter((i) => !i.checked).length,
    handleCustomItemAdded,
    handleCustomToggle,
    handleCustomUnlink,
    handleCustomDelete,
    handleClearChecked,
  }
}
