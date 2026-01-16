import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { getServerBaseURL } from '@/lib/env'
import { InventoryPage } from '@/components/inventory/InventoryPage'
import type { ShoppingEmptyStateVariant } from '@/components/inventory/ShoppingEmptyState'
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
  categoryLabel: string
  items: ShoppingListItem[]
}

interface ShoppingListResponse {
  windowDays: number
  startDate: string
  endDate: string
  generatedAt: string | null
  groups: ShoppingListGroup[]
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

  // Fetch pantry items
  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId: membership.householdId },
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          category: true,
          defaultUnit: true,
        },
      },
    },
    orderBy: [{ isStaple: 'desc' }, { ingredient: { name: 'asc' } }],
  })

  const formattedPantryItems = pantryItems.map((item) => ({
    id: item.id,
    ingredient: item.ingredient,
    quantity: item.quantity,
    isStaple: item.isStaple,
    updatedAt: item.updatedAt.toISOString(),
  }))

  // Parse days from query param (used when client preference differs from default)
  // Default to 7 days if not specified or invalid
  const daysParam = params.days
  const days = daysParam === '14' ? 14 : 7

  // Fetch rolling window shopping list
  const baseURL = getServerBaseURL()
  const cookieHeader = requestHeaders.get('cookie') ?? ''

  const shoppingResponse = await fetch(`${baseURL}/api/shopping-list?days=${days}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })

  if (!shoppingResponse.ok) {
    return (
      <InventoryPage
        pantryItems={formattedPantryItems}
        shoppingData={null}
        emptyStateVariant="error"
        windowDays={days}
      />
    )
  }

  const shoppingList: ShoppingListResponse = await shoppingResponse.json()

  // Check for nothing-needed state (empty groups)
  let emptyStateVariant: ShoppingEmptyStateVariant | undefined
  if (shoppingList.groups.length === 0 || shoppingList.summary.totalItems === 0) {
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
    categoryLabel: group.categoryLabel,
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
  }

  return (
    <InventoryPage
      pantryItems={formattedPantryItems}
      shoppingData={emptyStateVariant ? null : shoppingData}
      emptyStateVariant={emptyStateVariant}
      windowDays={days}
    />
  )
}
