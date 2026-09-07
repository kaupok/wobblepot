import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { getServerBaseURL } from '@/lib/env'
import { InventoryPage } from '@/components/inventory/InventoryPage'
import type { ShoppingEmptyStateVariant } from '@/components/inventory/ShoppingEmptyState'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

interface ShoppingListItem {
  ingredientId: string
  name: string
  quantity: number
  unit: Unit
  displayQuantity: string
  mealCount: number
  purchased: boolean
  neededByDate: string
  neededByRelative: string
  neededByAbsolute: string
}

interface ShoppingListGroup {
  category: IngredientCategory
  items: ShoppingListItem[]
}

interface CustomShoppingItemResponse {
  id: string
  name: string
  checked: boolean
  ingredientId: string | null
  ingredientCategory: string | null
  createdAt: string
}

interface ShoppingListResponse {
  windowDays: number
  startDate: string
  endDate: string
  generatedAt: string | null
  groups: ShoppingListGroup[]
  customItems: CustomShoppingItemResponse[]
  summary: {
    totalItems: number
    purchasedItems: number
    remainingItems: number
  }
}

interface ShoppingPageProps {
  searchParams: Promise<{ days?: string }>
}

export default async function ShoppingPage({ searchParams }: ShoppingPageProps) {
  const requestHeaders = await headers()
  const params = await searchParams

  const session = await auth.api.getSession({
    headers: requestHeaders,
  })

  if (!session) {
    redirect('/sign-in')
  }

  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    redirect('/onboarding')
  }

  // Parse days from query param (used when client preference differs from default)
  // Default to 7 days if not specified or invalid
  const daysParam = params.days
  const days = daysParam === '14' ? 14 : 7
  // Whether the URL actually named a window, as opposed to falling through to
  // the default. `days` alone cannot say — `/shopping`, `?days=7` and
  // `?days=garbage` all produce 7 — and the client-side reconcile needs the
  // difference: it applies the saved preference only when the URL expressed
  // none, so an explicit link or a Back press is not overridden.
  const daysFromUrl = daysParam === '7' || daysParam === '14'

  const baseURL = getServerBaseURL()
  const cookieHeader = requestHeaders.get('cookie') ?? ''

  // Fetch pantry items and shopping list concurrently (independent requests)
  const [pantryResponse, shoppingResponse] = await Promise.all([
    fetch(`${baseURL}/api/pantry?days=${days}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseURL}/api/shopping-list?days=${days}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
  ])

  let formattedPantryItems: PantryItemData[] = []
  if (pantryResponse.ok) {
    const pantryData = await pantryResponse.json()
    formattedPantryItems = pantryData.items.map(
      (item: PantryItemData & { updatedAt: string | Date }) => ({
        id: item.id,
        ingredient: item.ingredient,
        quantity: item.quantity,
        isStaple: item.isStaple,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : item.updatedAt,
        neededQuantity: item.neededQuantity,
        neededDisplayQuantity: item.neededDisplayQuantity,
        windowDays: item.windowDays,
      }),
    )
  }

  if (!shoppingResponse.ok) {
    return (
      <InventoryPage
        key={days}
        pantryItems={formattedPantryItems}
        shoppingData={null}
        emptyStateVariant="error"
        windowDays={days}
        windowDaysFromUrl={daysFromUrl}
      />
    )
  }

  const shoppingList: ShoppingListResponse = await shoppingResponse.json()

  // Check for empty states (custom items prevent "nothing needed" empty state)
  const hasCustomItems = shoppingList.customItems.length > 0
  let emptyStateVariant: ShoppingEmptyStateVariant | undefined
  if (shoppingList.generatedAt === null && !hasCustomItems) {
    emptyStateVariant = 'no-plan'
  } else if (
    (shoppingList.groups.length === 0 || shoppingList.summary.totalItems === 0) &&
    !hasCustomItems
  ) {
    emptyStateVariant = 'nothing-needed'
  }

  // Extract initially purchased IDs
  const initialPurchasedIds = new Set<string>()
  for (const group of shoppingList.groups) {
    for (const item of group.items) {
      if (item.purchased) {
        initialPurchasedIds.add(item.ingredientId)
      }
    }
  }

  // Transform data for shopping section
  const groups = shoppingList.groups.map((group) => ({
    category: group.category,
    items: group.items.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      displayQuantity: item.displayQuantity,
      purchased: item.purchased,
      neededByDate: item.neededByDate,
      neededByRelative: item.neededByRelative,
      neededByAbsolute: item.neededByAbsolute,
    })),
  }))

  const shoppingData = {
    windowDays: shoppingList.windowDays,
    startDate: shoppingList.startDate,
    endDate: shoppingList.endDate,
    groups,
    initialPurchasedIds,
    customItems: shoppingList.customItems,
  }

  return (
    // `key={days}` is load-bearing, not cosmetic. `InventoryPage`
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
    <InventoryPage
      key={days}
      pantryItems={formattedPantryItems}
      shoppingData={emptyStateVariant ? null : shoppingData}
      emptyStateVariant={emptyStateVariant}
      windowDays={days}
      windowDaysFromUrl={daysFromUrl}
    />
  )
}
