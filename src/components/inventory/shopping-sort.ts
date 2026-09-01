import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'
import { getUrgencyBucket, type UrgencyBucket } from '@/lib/meal-planning/dates'

export type SortMode = 'category' | 'urgency' | 'alphabetical'

/** A row in alphabetical mode — computed shopping items and custom items interleave. */
export type AlphabeticalItem =
  | { kind: 'computed'; item: ShoppingItemData }
  | { kind: 'custom'; item: CustomItemData }

export const SORT_STORAGE_KEY = 'shopping-list-sort-mode'

/**
 * Read the persisted sort mode. Returns 'category' on the server so SSR and the
 * first client render agree; the real value is applied after mount.
 */
export function getInitialSortMode(): SortMode {
  if (typeof window === 'undefined') return 'category'
  const stored = localStorage.getItem(SORT_STORAGE_KEY)
  if (stored === 'urgency' || stored === 'alphabetical') return stored
  return 'category'
}

/**
 * Group items by how soon they are needed, oldest date first within each bucket.
 * Purchased items keep their date position rather than sinking to the bottom.
 * Empty buckets are omitted.
 */
export function buildUrgencyGroups(
  items: ShoppingItemData[],
): Array<{ bucket: UrgencyBucket; items: ShoppingItemData[] }> {
  const sortedItems = [...items].sort((a, b) => a.neededByDate.localeCompare(b.neededByDate))

  const bucketOrder: UrgencyBucket[] = ['today', 'tomorrow', 'this-week', 'later']
  const grouped = new Map<UrgencyBucket, ShoppingItemData[]>()

  for (const bucket of bucketOrder) {
    grouped.set(bucket, [])
  }

  for (const item of sortedItems) {
    grouped.get(getUrgencyBucket(item.neededByDate))!.push(item)
  }

  return bucketOrder
    .filter((bucket) => grouped.get(bucket)!.length > 0)
    .map((bucket) => ({ bucket, items: grouped.get(bucket)! }))
}

/**
 * Flatten computed and custom items into one A–Z list, with everything already
 * purchased or checked sorted to the bottom.
 */
export function buildAlphabeticalItems(
  items: ShoppingItemData[],
  customItems: CustomItemData[],
): AlphabeticalItem[] {
  const allItems: AlphabeticalItem[] = [
    ...items.map((item) => ({ kind: 'computed' as const, item })),
    ...customItems.map((item) => ({ kind: 'custom' as const, item })),
  ]

  return allItems.sort((a, b) => {
    const aPurchased = a.kind === 'computed' ? a.item.purchased : a.item.checked
    const bPurchased = b.kind === 'computed' ? b.item.purchased : b.item.checked

    // Purchased/checked items sort to bottom
    if (aPurchased !== bPurchased) return aPurchased ? 1 : -1

    return a.item.name.localeCompare(b.item.name)
  })
}

/**
 * Split custom items into those linked to a catalogued ingredient (so they can
 * render inside that ingredient's category group) and those that cannot be.
 */
export function splitCustomItems(customItems: CustomItemData[]): {
  linkedCustomByCategory: Map<string, CustomItemData[]>
  unlinkedCustomItems: CustomItemData[]
} {
  const linked = new Map<string, CustomItemData[]>()
  const unlinked: CustomItemData[] = []

  for (const item of customItems) {
    if (item.ingredientCategory) {
      const existing = linked.get(item.ingredientCategory) ?? []
      existing.push(item)
      linked.set(item.ingredientCategory, existing)
    } else {
      unlinked.push(item)
    }
  }

  return { linkedCustomByCategory: linked, unlinkedCustomItems: unlinked }
}
