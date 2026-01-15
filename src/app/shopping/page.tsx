import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { getServerBaseURL } from '@/lib/env'
import { ShoppingList } from '@/components/shopping/ShoppingList'
import { EmptyState } from '@/components/shopping/EmptyState'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

interface ShoppingListItem {
  ingredientId: string
  name: string
  quantity: number
  unit: Unit
  displayQuantity: string
  mealCount: number
  purchased: boolean
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

  // Fetch current meal plan
  const requestHeaders = await headers()
  const baseURL = getServerBaseURL()
  const cookieHeader = requestHeaders.get('cookie') ?? ''

  const planResponse = await fetch(`${baseURL}/api/meal-plans/current`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })

  // No current plan - show empty state
  if (!planResponse.ok) {
    return (
      <div className="container mx-auto max-w-2xl p-4">
        <EmptyState variant="no-plan" />
      </div>
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
      <div className="container mx-auto max-w-2xl p-4">
        <EmptyState variant="no-plan" />
      </div>
    )
  }

  const shoppingList: ShoppingListResponse = await shoppingResponse.json()

  // Check for nothing-needed state (empty groups)
  if (shoppingList.groups.length === 0 || shoppingList.summary.totalItems === 0) {
    return (
      <div className="container mx-auto max-w-2xl p-4">
        <EmptyState variant="nothing-needed" />
      </div>
    )
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

  // Transform data for ShoppingList component
  const groups = shoppingList.groups.map((group) => ({
    category: group.category,
    categoryLabel: group.categoryLabel,
    items: group.items.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      displayQuantity: item.displayQuantity,
      purchased: item.purchased,
    })),
  }))

  return (
    <div className="container mx-auto max-w-2xl p-4">
      <ShoppingList
        planId={shoppingList.planId}
        planStartDate={shoppingList.planStartDate}
        planEndDate={shoppingList.planEndDate}
        groups={groups}
        initialPurchasedIds={initialPurchasedIds}
      />
    </div>
  )
}
