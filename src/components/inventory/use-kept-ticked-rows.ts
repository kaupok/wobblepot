'use client'

import { type Dispatch, type SetStateAction, useMemo, useState } from 'react'

import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import type { IngredientCategory } from '@/generated/prisma/enums'

import { usePendingPurchaseIds } from './use-purchase-toggle'

interface ShoppingListGroup {
  category: IngredientCategory
  items: ShoppingItemData[]
}

interface KeptRow {
  category: IngredientCategory
  item: ShoppingItemData
}

type KeptRows = Map<string, KeptRow>

/**
 * Keeps a ticked row on the list after a re-read leaves it out. The server
 * drops a bought item, and a pantry change re-reads the list
 * (`router.refresh()`), so without this the ticked row would go and could not
 * be unticked (HON-1439). A kept row stays until the page is left, unticked
 * too, because an untick does not re-read the list.
 *
 * Each re-read keeps every row that was on screen ticked and that the server
 * left out, however it was ticked: a tap, or a pantry Undo (`usePantryChanges`).
 * The server is the authority on every row it lists: a listed item is never
 * bought (`load-shopping-list.ts`), so a re-read also unticks it. A tick still
 * in flight keeps its tick, because a re-read that lands first predates it.
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
      const keepIfTicked = (id: string, row: KeptRow) => {
        if (!listed.has(id) && purchasedIds.has(id)) next.set(id, row)
      }
      // The rows on screen: the last list's, then the ones already kept.
      seenGroups.forEach(({ category, items }) =>
        items.forEach((item) => keepIfTicked(item.ingredientId, { category, item })),
      )
      prev.forEach((row, id) => keepIfTicked(id, row))
      return next
    })
    setPurchasedIds((prev) => {
      const next = new Set([...prev].filter((id) => !listed.has(id) || pendingIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }

  // `kept` holds only rows the server left out, so none is listed twice.
  return useMemo(() => {
    if (kept.size === 0) return groups

    const merged = groups.map((group) => ({ ...group, items: [...group.items] }))
    for (const { category, item } of kept.values()) {
      const group = merged.find((g) => g.category === category)
      if (group) group.items.push(item)
      else merged.push({ category, items: [item] })
    }
    return merged
  }, [groups, kept])
}
