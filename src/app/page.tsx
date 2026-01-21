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
  formatCatchUpLabel,
} from '@/lib/meal-planning/dates'
import { TodayPage } from '@/components/today'
import type {
  MealPlanWithContext,
  PantryIngredient,
  PantryItemFull,
  PlanEntry,
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

  const [
    householdSize,
    currentPlanResponse,
    nextPlanResponse,
    lastPlanResponse,
    pantryResponse,
    shoppingResponse,
  ] = await Promise.all([
    getHouseholdMemberCount(household.id),
    fetch(`${baseURL}/api/meal-plans/current?week=current`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseURL}/api/meal-plans/current?week=next`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${baseURL}/api/meal-plans/current?week=last`, {
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

  // Build catch-up entries from past 7 days that are still "planned"
  // Collect entries from both current and last week's plans
  const catchUpEntries: (PlanEntry & { label: string; planId: string })[] = []
  const sevenDaysAgo = new Date(todayParsed)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const sevenDaysAgoStr = toDateString(sevenDaysAgo)

  // Helper to add catch-up entries from a plan
  function addCatchUpEntries(entries: PlanEntry[], planId: string) {
    for (const entry of entries) {
      // Only include entries that:
      // 1. Are before today
      // 2. Are within 7 days
      // 3. Are still "planned" (not completed/skipped)
      // 4. Have a meal assigned
      if (
        entry.date < todayDate &&
        entry.date >= sevenDaysAgoStr &&
        entry.status === 'planned' &&
        entry.meal
      ) {
        catchUpEntries.push({
          ...entry,
          planId,
          label: formatCatchUpLabel(entry.date, entry.mealType, todayParsed),
        })
      }
    }
  }

  // Add from current plan
  if (plan) {
    addCatchUpEntries(plan.entries, plan.id)
  }

  // Add from last week's plan
  if (lastPlanResponse.ok) {
    const lastPlan: MealPlanWithContext = await lastPlanResponse.json()
    addCatchUpEntries(lastPlan.entries, lastPlan.id)
  }

  // Sort by date (most recent first) then by meal type
  const mealTypeOrder = { dinner: 0, lunch: 1, breakfast: 2 }
  catchUpEntries.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date)
    if (dateCompare !== 0) return dateCompare
    return (
      (mealTypeOrder[a.mealType as keyof typeof mealTypeOrder] ?? 3) -
      (mealTypeOrder[b.mealType as keyof typeof mealTypeOrder] ?? 3)
    )
  })

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
      catchUpEntries={catchUpEntries}
      timezone={household.timezone}
    />
  )
}
