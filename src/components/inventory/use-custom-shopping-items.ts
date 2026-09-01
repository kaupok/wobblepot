'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'

/**
 * User-added shopping-list rows, separate from the ones computed from the meal
 * plan. Every mutation updates local state first — a checkbox that lags behind a
 * round trip feels broken. Only the toggle rolls back on failure; unlink, delete
 * and clear-checked currently do not — see the note on `handleCustomUnlink`
 * (HON-598).
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
        // NOTE: no rollback — the row stays rendered as unlinked even though the
        // server still has the link, until the next load. Same for delete and
        // clear-checked below. Pre-existing behaviour, moved here verbatim from
        // ShoppingSection; fixing it is HON-598, kept out of this
        // no-behaviour-change refactor.
        toast.error(tErrors('unlinkFailed'))
      }
    },
    [tErrors],
  )

  const handleCustomDelete = useCallback(
    async (id: string) => {
      // Optimistic update
      setCustomItems((prev) => prev.filter((item) => item.id !== id))

      try {
        const response = await fetch(`/api/shopping-list/custom/${id}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error(tErrors('removeFailed'))
        }
      } catch {
        toast.error(tErrors('removeFailed'))
      }
    },
    [tErrors],
  )

  const handleClearChecked = useCallback(async () => {
    const checkedIds = new Set(customItems.filter((i) => i.checked).map((i) => i.id))
    if (checkedIds.size === 0) return

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
