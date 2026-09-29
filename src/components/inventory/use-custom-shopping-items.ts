'use client'

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useMutationState } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'
import { apiFetch, ApiError } from '@/lib/api'

/**
 * Shared prefix of the per-row mutations (toggle, unlink, delete), so
 * `pendingCustomIds` can be read off the mutation cache for all three at once.
 * Clear-checked is not a per-row mutation and was never part of that set.
 */
const CUSTOM_ROW_KEY = ['shopping-list', 'custom', 'row'] as const

/**
 * User-added shopping-list rows, separate from the ones computed from the meal
 * plan. Every mutation updates local state first — a checkbox that lags behind a
 * round trip feels broken — and rolls that update back when the request fails,
 * so the list never contradicts its own error toast. Per-row mutations are
 * guarded by `pendingCustomIds`, so a second click while one is in flight is
 * dropped rather than racing the first one's rollback.
 */
export function useCustomShoppingItems(initialCustomItems: CustomItemData[]) {
  const tErrors = useTranslations('shopping.errors')
  const [customItems, setCustomItems] = useState<CustomItemData[]>(initialCustomItems)

  // Several rows can be in flight at once, so the pending set is derived from
  // the mutation cache rather than one mutation's `isPending`.
  const pendingIdList = useMutationState({
    filters: { mutationKey: CUSTOM_ROW_KEY, status: 'pending' },
    select: (mutation) => (mutation.state.variables as { id: string }).id,
  })
  const pendingCustomIds = useMemo(() => new Set(pendingIdList), [pendingIdList])

  const handleCustomItemAdded = useCallback((item: CustomItemData) => {
    setCustomItems((prev) => [item, ...prev])
  }, [])

  const toggleMutation = useMutation({
    mutationKey: [...CUSTOM_ROW_KEY, 'toggle'],
    mutationFn: ({ id, checked }: { id: string; checked: boolean }) =>
      apiFetch(
        `/api/shopping-list/custom/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked }),
        },
        tErrors('updateFailed'),
      ),
    onMutate: ({ id, checked }) => {
      // Optimistic update
      setCustomItems((prev) => prev.map((item) => (item.id === id ? { ...item, checked } : item)))
    },
    onError: (error, { id, checked }) => {
      // Revert optimistic update
      setCustomItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, checked: !checked } : item)),
      )
      toast.error(error.message)
    },
  })

  const unlinkMutation = useMutation({
    mutationKey: [...CUSTOM_ROW_KEY, 'unlink'],
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(
        `/api/shopping-list/custom/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredientId: null }),
        },
        tErrors('unlinkFailed'),
      ),
    onMutate: ({ id }) => {
      const previous = customItems.find((item) => item.id === id)

      // Optimistic update
      setCustomItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, ingredientId: null, ingredientCategory: null } : item,
        ),
      )
      return { previous }
    },
    onError: (_error, { id }, context) => {
      // Revert only the two fields we edited — the row may have been checked
      // while the request was in flight, and that toggle is not ours to undo.
      // A snapshot that is already unlinked belongs to a second click that
      // read the first one's optimistic state; restoring it would overwrite
      // the real link the first click is about to put back. There was nothing
      // to unlink in that case either, so skipping is also the honest revert.
      const previous = context?.previous
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
    },
  })

  const deleteMutation = useMutation({
    mutationKey: [...CUSTOM_ROW_KEY, 'delete'],
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`/api/shopping-list/custom/${id}`, { method: 'DELETE' }).catch((error) => {
        // The route answers 404 for two different things: the row is already
        // gone ('Item not found' — a delete that won a race, so putting the
        // row back would resurrect it on screen), or the session has no
        // household ('No household found'), where the row is still there and
        // the delete really did fail. Only the first is treated as done.
        const alreadyGone =
          error instanceof ApiError && error.status === 404 && error.message === 'Item not found'

        if (!alreadyGone) throw error
      }),
    onMutate: ({ id }) => {
      const removedIndex = customItems.findIndex((item) => item.id === id)
      const removed = customItems[removedIndex]
      // Anchor the rollback on the row that preceded it, not on the index: rows
      // added or removed while the request is in flight shift that index.
      const precedingId = removedIndex > 0 ? customItems[removedIndex - 1]?.id : undefined

      // Optimistic update
      setCustomItems((prev) => prev.filter((item) => item.id !== id))
      return { removed, removedIndex, precedingId }
    },
    onError: (_error, { id }, context) => {
      // Put the row back where it was — appending would silently reorder the
      // list. Insert after the row it used to follow; only when that anchor
      // is gone too does it fall back to the captured index, which `splice`
      // clamps. The presence check keeps it from being inserted twice.
      if (context?.removed) {
        const { removed, removedIndex, precedingId } = context
        setCustomItems((prev) => {
          if (prev.some((item) => item.id === id)) return prev
          const anchor = precedingId ? prev.findIndex((item) => item.id === precedingId) : -1
          const next = [...prev]
          next.splice(anchor >= 0 ? anchor + 1 : removedIndex, 0, removed)
          return next
        })
      }
      toast.error(tErrors('removeFailed'))
    },
  })

  const clearCheckedMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/shopping-list/custom/checked',
        { method: 'DELETE' },
        tErrors('clearCheckedFailed'),
      ),
    onMutate: () => {
      const checkedIds = new Set(customItems.filter((i) => i.checked).map((i) => i.id))
      const previousItems = customItems

      // Optimistic update
      setCustomItems((prev) => prev.filter((item) => !item.checked))
      return { checkedIds, previousItems }
    },
    onError: (_error, _variables, context) => {
      // Rebuild from the snapshot rather than assigning it. Only the rows this
      // request removed come back — `checkedIds` is exactly that set, so a row
      // dropped by a concurrent delete that succeeded stays gone instead of
      // being resurrected. A row edited while the request was in flight keeps
      // its current version, and a row added in that window stays at the head
      // where `handleCustomItemAdded` put it.
      if (context) {
        const { checkedIds, previousItems } = context
        setCustomItems((prev) => {
          const current = new Map(prev.map((item) => [item.id, item]))
          const snapshotIds = new Set(previousItems.map((item) => item.id))
          const added = prev.filter((item) => !snapshotIds.has(item.id))
          const restored = previousItems
            .filter((item) => current.has(item.id) || checkedIds.has(item.id))
            .map((item) => current.get(item.id) ?? item)
          return [...added, ...restored]
        })
      }
      toast.error(tErrors('clearCheckedFailed'))
    },
  })

  const { mutate: toggle } = toggleMutation
  const { mutate: unlink } = unlinkMutation
  const { mutate: remove } = deleteMutation
  const { mutate: clearChecked } = clearCheckedMutation

  const handleCustomToggle = useCallback(
    (id: string, checked: boolean) => {
      if (pendingCustomIds.has(id)) return
      toggle({ id, checked })
    },
    [pendingCustomIds, toggle],
  )

  const handleCustomUnlink = useCallback(
    (id: string) => {
      if (pendingCustomIds.has(id)) return
      unlink({ id })
    },
    [pendingCustomIds, unlink],
  )

  const handleCustomDelete = useCallback(
    (id: string) => {
      if (pendingCustomIds.has(id)) return
      remove({ id })
    },
    [pendingCustomIds, remove],
  )

  const handleClearChecked = useCallback(() => {
    if (!customItems.some((i) => i.checked)) return
    clearChecked()
  }, [customItems, clearChecked])

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
