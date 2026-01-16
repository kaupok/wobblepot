import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Heading, Body } from '@/components/ui/typography'
import { serverEnv, getServerBaseURL } from '@/lib/env'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import {
  getTodayInTimezone,
  getUrgencyBucket,
  parseLocalDate,
  toDateString,
} from '@/lib/meal-planning/dates'
import { TodayPage } from '@/components/today'
import type {
  MealPlanWithContext,
  PantryIngredient,
  PantryItemFull,
} from '@/components/meal-plan/types'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

interface ShoppingItem {
  ingredientId: string
  name: string
  displayQuantity: string
  neededByDate: string
  neededByRelative: string
  purchased: boolean
  urgency: UrgencyBucket
}

interface ShoppingListResponse {
  windowDays: number
  startDate: string
  endDate: string
  generatedAt: string | null
  groups: {
    category: IngredientCategory
    categoryLabel: string
    items: {
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
    }[]
  }[]
  summary: {
    totalItems: number
    purchasedItems: number
    remainingItems: number
  }
}

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // Landing page for unauthenticated users
  if (!session) {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center">
        <main className="flex flex-col items-center gap-8">
          <Heading>{serverEnv.NEXT_PUBLIC_APP_NAME}</Heading>
          <Body variant="muted">Get started by signing in or creating an account</Body>
        </main>
      </div>
    )
  }

  // Check household membership
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    redirect('/onboarding')
  }

  const { household } = membership

  // Get today and tomorrow dates in household timezone
  const todayDate = getTodayInTimezone(household.timezone)
  const todayParsed = parseLocalDate(todayDate)
  const tomorrowParsed = new Date(todayParsed)
  tomorrowParsed.setDate(tomorrowParsed.getDate() + 1)
  const tomorrowDate = toDateString(tomorrowParsed)

  // Fetch data in parallel
  const requestHeaders = await headers()
  const baseURL = getServerBaseURL()
  const cookieHeader = requestHeaders.get('cookie') ?? ''

  const [householdSize, currentPlanResponse, nextPlanResponse, pantryResponse, shoppingResponse] =
    await Promise.all([
      getHouseholdMemberCount(household.id),
      fetch(`${baseURL}/api/meal-plans/current?week=current`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      }),
      fetch(`${baseURL}/api/meal-plans/current?week=next`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      }),
      fetch(`${baseURL}/api/pantry`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      }),
      fetch(`${baseURL}/api/shopping-list?days=7`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      }),
    ])

  // Parse pantry response
  let pantryIngredients: PantryIngredient[] = []
  let pantryItems: PantryItemFull[] = []
  if (pantryResponse.ok) {
    const pantryData = await pantryResponse.json()
    pantryItems = pantryData.items
    pantryIngredients = pantryData.items.map(
      (item: { ingredient: { id: string }; isStaple: boolean }) => ({
        ingredientId: item.ingredient.id,
        isStaple: item.isStaple,
      }),
    )
  }

  // Determine which plan to use - current week or next week
  // (tomorrow might be in next week's plan if today is Sunday)
  let plan: MealPlanWithContext | null = null
  if (currentPlanResponse.ok) {
    plan = await currentPlanResponse.json()
  }

  // If we need tomorrow's meals and they're not in current plan, merge from next plan
  if (nextPlanResponse.ok) {
    const nextPlan: MealPlanWithContext = await nextPlanResponse.json()
    if (!plan) {
      // No current plan, use next plan
      plan = nextPlan
    } else {
      // Check if tomorrow is in next week's plan
      const tomorrowInCurrent = plan.entries.some((e) => e.date === tomorrowDate)
      if (!tomorrowInCurrent) {
        // Merge tomorrow's entries from next plan
        const tomorrowEntries = nextPlan.entries.filter((e) => e.date === tomorrowDate)
        plan = {
          ...plan,
          entries: [...plan.entries, ...tomorrowEntries],
        }
      }
    }
  }

  // Parse shopping response and add urgency
  const shoppingItems: ShoppingItem[] = []
  if (shoppingResponse.ok) {
    const shoppingData: ShoppingListResponse = await shoppingResponse.json()
    for (const group of shoppingData.groups) {
      for (const item of group.items) {
        shoppingItems.push({
          ingredientId: item.ingredientId,
          name: item.name,
          displayQuantity: item.displayQuantity,
          neededByDate: item.neededByDate,
          neededByRelative: item.neededByRelative,
          purchased: item.purchased,
          urgency: getUrgencyBucket(item.neededByDate),
        })
      }
    }
  }

  return (
    <TodayPage
      todayDate={todayDate}
      tomorrowDate={tomorrowDate}
      plan={plan}
      householdSize={householdSize}
      pantryIngredients={pantryIngredients}
      pantryItems={pantryItems}
      shoppingItems={shoppingItems}
    />
  )
}
