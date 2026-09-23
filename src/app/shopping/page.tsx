import { InventoryPage } from '@/components/inventory/InventoryPage'
import { loadInventory } from './load-inventory'

interface ShoppingPageProps {
  searchParams: Promise<{ days?: string }>
}

export default async function ShoppingPage({ searchParams }: ShoppingPageProps) {
  const { days } = await searchParams
  const data = await loadInventory(days)

  return (
    // `key={windowDays}` is load-bearing, not cosmetic. `InventoryPage`
    // (`pantryItems`), `ShoppingSection` (`purchasedIds`) and
    // `useCustomShoppingItems` (`customItems`) all seed state with
    // `useState(prop)`, which is only correct if a window change remounts them
    // — and it does not: Next strips search params out of the page segment's
    // React key (`createRouterCacheKey(activeSegment, true) // no search
    // params`, layout-router.js:549, used as the element key at :672), so
    // `?days=7` → `?days=14` refetches the payload and reconciles the existing
    // tree. Without the key, `purchasedIds` from the old window survives into
    // the new one: narrowing 14 → 7 can make `allPurchased` count purchased ids
    // that are no longer in the list, replacing it with "All done!" over items
    // the user never bought. This became reachable when the picker moved onto
    // the populated list — previously `?days=` only changed from an empty state,
    // where `ShoppingSection` was not mounted to begin with.
    <InventoryPage key={data.windowDays} view="shopping" {...data} />
  )
}
