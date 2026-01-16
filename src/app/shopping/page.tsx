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
  planId: string
  planStartDate: string
  planEndDate: string
  generatedAt: string
  groups: ShoppingListGroup[]
  summary: {
    totalItems: number
    purchasedItems: number
    remainingItems: number
  }
}

export default async function ShoppingPage() {
  const requestHeaders = await headers()

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

  // Fetch current meal plan
  const baseURL = getServerBaseURL()
  const cookieHeader = requestHeaders.get('cookie') ?? ''

  const planResponse = await fetch(`${baseURL}/api/meal-plans/current`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })

  // No current plan - show empty state for shopping, but still show pantry
  if (!planResponse.ok) {
    return (
      <InventoryPage
        pantryItems={formattedPantryItems}
        shoppingData={null}
        emptyStateVariant="no-plan"
      />
    )
  }

  const plan = await planResponse.json()

  // Fetch shopping list for this plan
  const shoppingResponse = await fetch(`${baseURL}/api/meal-plans/${plan.id}/shopping-list`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })

  if (!shoppingResponse.ok) {
    return (
      <InventoryPage
        pantryItems={formattedPantryItems}
        shoppingData={null}
        emptyStateVariant="error"
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
    planId: shoppingList.planId,
    planStartDate: shoppingList.planStartDate,
    planEndDate: shoppingList.planEndDate,
    groups,
    initialPurchasedIds,
  }

  return (
    <InventoryPage
      pantryItems={formattedPantryItems}
      shoppingData={emptyStateVariant ? null : shoppingData}
      emptyStateVariant={emptyStateVariant}
    />
  )
}
