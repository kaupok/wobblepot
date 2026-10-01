import 'server-only'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import type { ComponentProps } from 'react'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { loadPantry, type PantryResult } from '@/lib/meal-planning/load-pantry'
import { loadShoppingList, type ShoppingListResult } from '@/lib/shopping/load-shopping-list'
import type { InventoryPage } from '@/components/inventory/InventoryPage'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { toShoppingItemData } from './shopping-item-transform'
import { toPantryItemData } from './pantry-item-transform'
import { getShoppingEmptyStateVariant } from './shopping-empty-state-variant'

export type InventoryPageData = Omit<ComponentProps<typeof InventoryPage>, 'view'>

/**
 * Everything `/shopping` and `/pantry` render from, resolved on the server.
 * The two routes are one page at `md` and up (pantry left, list right) and
 * differ only in which half a phone sees, so they share this loader and each
 * passes its own `view` (HON-776). Redirects to sign-in or onboarding itself.
 */
export async function loadInventory(daysParam: string | undefined): Promise<InventoryPageData> {
  const session = await auth.api.getSession({
    headers: await headers(),
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
  const days: 7 | 14 = daysParam === '14' ? 14 : 7
  // Whether the URL actually named a window, as opposed to falling through to
  // the default. `days` alone cannot say — `/shopping`, `?days=7` and
  // `?days=garbage` all produce 7 — and the client-side reconcile needs the
  // difference: it applies the saved preference only when the URL expressed
  // none, so an explicit link or a Back press is not overridden.
  const daysFromUrl = daysParam === '7' || daysParam === '14'

  const { household } = membership

  // Each loader settles on its own, so one failing does not take the other
  // section down with it (below).
  const [pantryResult, shoppingList] = await Promise.all([
    loadPantry(household, { days }).catch((error: unknown): PantryResult | null => {
      captureApiError(error, {
        route: '/shopping',
        section: 'pantry',
        userId: session.user.id,
        householdId: household.id,
      })
      return null
    }),
    loadShoppingList(household, { days }).catch((error: unknown): ShoppingListResult | null => {
      captureApiError(error, {
        route: '/shopping',
        section: 'shopping-list',
        userId: session.user.id,
        householdId: household.id,
      })
      return null
    }),
  ])

  // A failed pantry load must not read as an empty pantry: on a phone `/pantry`
  // is nothing but this list, so "Your pantry is empty" after a transient 500
  // would tell the user their stock is gone. Not thrown either — the shopping
  // list beside it on desktop loaded fine and should still render.
  const pantryLoadFailed = pantryResult === null
  const formattedPantryItems: PantryItemData[] = pantryResult
    ? pantryResult.items.map(toPantryItemData)
    : []

  if (!shoppingList) {
    return {
      pantryItems: formattedPantryItems,
      pantryLoadFailed,
      shoppingData: null,
      emptyStateVariant: 'error',
      windowDays: days,
      windowDaysFromUrl: daysFromUrl,
    }
  }

  const emptyStateVariant = getShoppingEmptyStateVariant({
    hasAnyPlan: shoppingList.hasAnyPlan,
    groupCount: shoppingList.groups.length,
    totalItems: shoppingList.summary.totalItems,
    customItemCount: shoppingList.customItems.length,
  })

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
    items: group.items.map(toShoppingItemData),
  }))

  const shoppingData = {
    windowDays: shoppingList.windowDays,
    startDate: shoppingList.startDate,
    endDate: shoppingList.endDate,
    groups,
    initialPurchasedIds,
    customItems: shoppingList.customItems,
  }

  return {
    pantryItems: formattedPantryItems,
    pantryLoadFailed,
    shoppingData: emptyStateVariant ? null : shoppingData,
    emptyStateVariant,
    windowDays: days,
    windowDaysFromUrl: daysFromUrl,
  }
}
