'use client'

import { useCallback, useMemo, useState } from 'react'
import type { IngredientCategory } from '@/generated/prisma/enums'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'

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
 * Each re-read keeps only the rows still ticked that the server left out: the
 * server's copy of a row wins, and it is the authority on an unticked one.
 */
export function useKeptTickedRows(groups: ShoppingListGroup[], purchasedIds: Set<string>) {
  const [kept, setKept] = useState<KeptRows>(() => new Map())
  const [seenGroups, setSeenGroups] = useState(groups)

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
