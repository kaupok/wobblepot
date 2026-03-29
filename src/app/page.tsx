import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { CheckCircle2 } from 'lucide-react'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { getServerBaseURL } from '@/lib/env'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import {
  getTodayInTimezone,
  getUrgencyBucket,
  toDateString,
  parseLocalDate,
} from '@/lib/meal-planning/dates'
import { TimelineView } from '@/components/timeline'
import { FirstTimeSetup } from '@/components/timeline'
import type {
  PantryIngredient,
  PantryItemFull,
  PlanEntry,
  ExpectedMealTypes,
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
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center px-4">
        <main className="flex max-w-2xl flex-col items-center gap-8 text-center">
          <div className="flex flex-col gap-4">
            <Heading>Meal planning for busy families</Heading>
            <Body variant="lead">
              AI-powered weekly meal plans tailored to your household&apos;s preferences, dietary
              needs, and what&apos;s already in your pantry.
            </Body>
          </div>

          <Button asChild size="lg">
            <Link href="/sign-up">Get started - it&apos;s free</Link>
          </Button>

          <ul className="flex flex-col gap-3 text-left">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="text-primary h-5 w-5 shrink-0" />
              <Body>Personalized for your household</Body>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="text-primary h-5 w-5 shrink-0" />
              <Body>Smart shopping lists</Body>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="text-primary h-5 w-5 shrink-0" />
              <Body>Tracks what you have on hand</Body>
            </li>
          </ul>
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

  // Get today's date in household timezone
  const todayDate = getTodayInTimezone(household.timezone)
  const todayParsed = parseLocalDate(todayDate)

  // Compute date range: -7 to +14 from today
  const sevenDaysAgo = new Date(todayParsed)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const fourteenDaysAhead = new Date(todayParsed)
  fourteenDaysAhead.setDate(fourteenDaysAhead.getDate() + 15) // +15 because endDate is exclusive

  // Fetch data in parallel
  const requestHeaders = await headers()
  const baseURL = getServerBaseURL()
  const cookieHeader = requestHeaders.get('cookie') ?? ''

  const [householdSize, entriesResponse, pantryResponse, shoppingResponse, prefsResponse] =
    await Promise.all([
      getHouseholdMemberCount(household.id),
      fetch(
        `${baseURL}/api/entries?startDate=${toDateString(sevenDaysAgo)}&endDate=${toDateString(fourteenDaysAhead)}`,
        {
          headers: { cookie: cookieHeader },
          cache: 'no-store',
        },
      ),
      fetch(`${baseURL}/api/pantry`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      }),
      fetch(`${baseURL}/api/shopping-list?days=7`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      }),
      fetch(`${baseURL}/api/households/me/preferences`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      }),
    ])

  // Parse entries
  let entries: PlanEntry[] = []
  let planId: string | null = null
  if (entriesResponse.ok) {
    const entriesData = await entriesResponse.json()
    entries = entriesData.entries
    planId = entriesData.planId
  }

  // First-time user: no entries and no plan (only when API succeeded)
  if (entriesResponse.ok && entries.length === 0 && !planId) {
    return <FirstTimeSetup userName={session.user.name} />
  }

  // Parse pantry
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

  // Parse shopping list
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

  // Parse household preferences for expected meal types
  const expectedMealTypes: ExpectedMealTypes = {
    weekdayMealTypes: ['dinner'],
    weekendMealTypes: ['dinner'],
  }
  if (prefsResponse.ok) {
    const prefsData = await prefsResponse.json()
    if (prefsData.weekdayMealTypes?.length > 0) {
      expectedMealTypes.weekdayMealTypes = prefsData.weekdayMealTypes
    }
    if (prefsData.weekendMealTypes?.length > 0) {
      expectedMealTypes.weekendMealTypes = prefsData.weekendMealTypes
    }
  }

  return (
    <TimelineView
      entries={entries}
      planId={planId ?? ''}
      expectedMealTypes={expectedMealTypes}
      householdSize={householdSize}
      pantryIngredients={pantryIngredients}
      pantryItems={pantryItems}
      shoppingItems={shoppingItems}
      todayDate={todayDate}
    />
  )
}
