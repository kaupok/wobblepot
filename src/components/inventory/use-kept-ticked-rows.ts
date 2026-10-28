'use client'

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { IngredientCategory } from '@/generated/prisma/enums'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { usePendingPurchaseIds } from './use-purchase-toggle'

interface ShoppingListGroup {
  category: IngredientCategory
  items: ShoppingItemData[]
}

type KeptRows = Map<string, { category: IngredientCategory; item: ShoppingItemData }>

/**
 * Keeps a row the household ticked on the list after a re-read leaves it out.
 * The server drops a bought item, and a pantry change re-reads the list
 * (`router.refresh()`), so without this the ticked row would go and could not
 * be unticked (HON-1439). A kept row stays until the page is left, unticked
 * too, because an untick does not re-read the list.
 *
 * Each re-read keeps only the rows still ticked that the server left out. The
 * server is the authority on every row it lists: a listed item is never bought
 * (`load-shopping-list.ts`), so a re-read also unticks it. A tick still in
 * flight keeps its tick, because a re-read that lands first predates it.
 */
export function useKeptTickedRows(
  groups: ShoppingListGroup[],
  purchasedIds: Set<string>,
  setPurchasedIds: Dispatch<SetStateAction<Set<string>>>,
) {
  const [kept, setKept] = useState<KeptRows>(() => new Map())
  const [seenGroups, setSeenGroups] = useState(groups)
  const pendingIds = usePendingPurchaseIds()

  // A new `groups` is a re-read: prune while rendering, so the stale rows
  // never paint (react.dev → "Adjusting some state when a prop changes").
  if (groups !== seenGroups) {
    setSeenGroups(groups)
    const listed = new Set(groups.flatMap((group) => group.items.map((item) => item.ingredientId)))
    setKept((prev) => {
      const next: KeptRows = new Map()
      prev.forEach((row, id) => {
        if (!listed.has(id) && purchasedIds.has(id)) next.set(id, row)
      })
      return next
    })
    setPurchasedIds((prev) => {
      const next = new Set([...prev].filter((id) => !listed.has(id) || pendingIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }

  const displayGroups = useMemo(() => {
    const listed = new Set(groups.flatMap((group) => group.items.map((item) => item.ingredientId)))
    const extra = [...kept].filter(([id]) => !listed.has(id))
    if (extra.length === 0) return groups

    const merged = groups.map((group) => ({ ...group, items: [...group.items] }))
    for (const [, { category, item }] of extra) {
      const group = merged.find((g) => g.category === category)
      if (group) group.items.push(item)
      else merged.push({ category, items: [item] })
    }
    return merged
  }, [groups, kept])

  /** Records the row as it is on screen now, so a re-read cannot drop it. */
  const keep = useCallback(
    (ingredientId: string) => {
      for (const group of displayGroups) {
        const item = group.items.find((i) => i.ingredientId === ingredientId)
        if (item) {
          setKept((prev) => new Map(prev).set(ingredientId, { category: group.category, item }))
          return
        }
      }
    },
    [displayGroups],
  )

  return { displayGroups, keep }
}
