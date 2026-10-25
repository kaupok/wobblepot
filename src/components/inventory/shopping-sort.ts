import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'
import { getUrgencyBucket, type UrgencyBucket } from '@/lib/meal-planning/dates'

export type SortMode = 'category' | 'urgency' | 'alphabetical'

/** A row in alphabetical mode — computed shopping items and custom items interleave. */
export type AlphabeticalItem =
  { kind: 'computed'; item: ShoppingItemData } | { kind: 'custom'; item: CustomItemData }

export const SORT_STORAGE_KEY = 'shopping-list-sort-mode'

/**
 * The mode a browser with no saved choice opens in. Urgency answers what the
 * list is for — what to buy before the next meal (HON-959).
 */
export const DEFAULT_SORT_MODE: SortMode = 'urgency'

/**
 * Read the persisted sort mode. Returns the default on the server so SSR and the
 * first client render agree; the real value is applied after mount.
 */
export function getInitialSortMode(): SortMode {
  if (typeof window === 'undefined') return DEFAULT_SORT_MODE
  const stored = localStorage.getItem(SORT_STORAGE_KEY)
  if (stored === 'category' || stored === 'urgency' || stored === 'alphabetical') return stored
  return DEFAULT_SORT_MODE
}

/** A bucket of the urgency sort, with its computed lines and its dated manual items. */
export interface UrgencyGroupData {
  bucket: UrgencyBucket
  items: ShoppingItemData[]
  customItems: CustomItemData[]
}

const byDate = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Group items by how soon they are needed, oldest date first within each bucket.
 * Purchased items keep their date position rather than sinking to the bottom.
 * A manual item with a `neededBy` date (a free-text day extra's, HON-1310)
 * joins its date's bucket, after the computed lines; one without stays out,
 * for the manual items section. Empty buckets are omitted.
 */
export function buildUrgencyGroups(
  items: ShoppingItemData[],
  customItems: CustomItemData[] = [],
): UrgencyGroupData[] {
  const bucketOrder: UrgencyBucket[] = ['today', 'tomorrow', 'this-week', 'later']
  const grouped = new Map<UrgencyBucket, UrgencyGroupData>(
    bucketOrder.map((bucket) => [bucket, { bucket, items: [], customItems: [] }]),
  )

  // ISO dates order by code unit; collation has nothing to add.
  for (const item of [...items].sort((a, b) => byDate(a.neededByDate, b.neededByDate))) {
    grouped.get(getUrgencyBucket(item.neededByDate))!.items.push(item)
  }
  const dated = customItems.filter((item): item is CustomItemData & { neededBy: string } =>
    Boolean(item.neededBy),
  )
  for (const item of dated.sort((a, b) => byDate(a.neededBy, b.neededBy))) {
    grouped.get(getUrgencyBucket(item.neededBy))!.customItems.push(item)
  }

  return [...grouped.values()].filter(
    (group) => group.items.length > 0 || group.customItems.length > 0,
  )
}

/**
 * Flatten computed and custom items into one A–Z list, with everything already
 * purchased or checked sorted to the bottom. Names are collated in the
 * household's `locale`, not the browser's, so an Estonian list is in Estonian
 * order whatever language the browser speaks (HON-920).
 */
export function buildAlphabeticalItems(
  items: ShoppingItemData[],
  customItems: CustomItemData[],
  locale: string,
): AlphabeticalItem[] {
  const collator = new Intl.Collator(locale)
  const allItems: AlphabeticalItem[] = [
    ...items.map((item) => ({ kind: 'computed' as const, item })),
    ...customItems.map((item) => ({ kind: 'custom' as const, item })),
  ]

  return allItems.sort((a, b) => {
    const aPurchased = a.kind === 'computed' ? a.item.purchased : a.item.checked
    const bPurchased = b.kind === 'computed' ? b.item.purchased : b.item.checked

    // Purchased/checked items sort to bottom
    if (aPurchased !== bPurchased) return aPurchased ? 1 : -1

    return collator.compare(a.item.name, b.item.name)
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
