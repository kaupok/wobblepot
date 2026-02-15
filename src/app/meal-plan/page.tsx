import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { getServerBaseURL } from '@/lib/env'
import { getDaysRemaining, isSunday } from '@/lib/meal-planning/dates'
import { WeekView } from '@/components/meal-plan/WeekView'
import { EmptyPlan } from '@/components/meal-plan/EmptyPlan'
import { WeekTabs } from '@/components/meal-plan/WeekTabs'
import type {
  ExpectedMealTypes,
  HouseholdPreferencesData,
  MealPlanWithContext,
  PantryIngredient,
  PantryItemFull,
  WeekContext,
} from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

interface PageProps {
  searchParams: Promise<{ week?: string }>
}

export default async function DashboardPage({ searchParams }: PageProps) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  // Household membership check
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    redirect('/onboarding')
  }

  const params = await searchParams
  const timezone = membership.household.timezone
  const currentWeekDays = getDaysRemaining(timezone)
  const isCurrentlySunday = isSunday()

  // Determine active week from URL param
  // On Sunday with no param, default to 'next'
  // Otherwise default to 'current'
  let activeWeek: 'last' | 'current' | 'next'
  if (params.week === 'last') {
    activeWeek = 'last'
  } else if (params.week === 'next') {
    activeWeek = 'next'
  } else if (params.week === 'current') {
    activeWeek = isCurrentlySunday ? 'next' : 'current' // Redirect Sunday to next
  } else {
    activeWeek = isCurrentlySunday ? 'next' : 'current'
  }

  // Fetch household size, all week plans, and pantry in parallel
  const requestHeaders = await headers()
  const baseURL = getServerBaseURL()
  const cookieHeader = requestHeaders.get('cookie') ?? ''

  const [householdSize, lastResponse, currentResponse, nextResponse, pantryResponse] =
    await Promise.all([
      getHouseholdMemberCount(membership.household.id),
      fetch(`${baseURL}/api/meal-plans/current?week=last`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      }),
      isCurrentlySunday
        ? Promise.resolve(null)
        : fetch(`${baseURL}/api/meal-plans/current?week=current`, {
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

  // Parse responses
  const hasLastPlan = lastResponse.ok
  const hasCurrentPlan = currentResponse?.ok ?? false
  const hasNextPlan = nextResponse.ok

  // Get the active plan data
  const activeResponse =
    activeWeek === 'last' ? lastResponse : activeWeek === 'current' ? currentResponse : nextResponse
  const hasPlan = activeResponse?.ok ?? false

  let plan: MealPlanWithContext | null = null
  let weekContext: WeekContext | null = null

  if (hasPlan && activeResponse) {
    plan = await activeResponse.json()
    weekContext = plan?.weekContext ?? null
  } else if (activeResponse) {
    // Extract weekContext from 404 response
    const errorData = await activeResponse.json().catch(() => ({}))
    if (errorData.weekContext) {
      weekContext = {
        type: activeWeek,
        daysCount: errorData.weekContext.daysRemaining ?? currentWeekDays,
        isPartialWeek: (errorData.weekContext.daysRemaining ?? currentWeekDays) < 7,
      }
    }
  }

  // Fallback weekContext if not provided
  if (!weekContext) {
    weekContext = {
      type: activeWeek,
      daysCount: activeWeek === 'current' ? currentWeekDays : 7,
      isPartialWeek: activeWeek === 'current' && currentWeekDays < 7,
    }
  }

  // Last week is always read-only
  const isReadOnly = activeWeek === 'last'

  // Get expected meal types from household preferences
  const preferences = membership.household.preferences
  const expectedMealTypes: ExpectedMealTypes = {
    weekdayMealTypes: (preferences?.weekdayMealTypes ?? ['dinner']) as MealType[],
    weekendMealTypes: (preferences?.weekendMealTypes ?? ['dinner']) as MealType[],
  }

  // Check if this is the first-ever generation (no plans exist for any week)
  const isFirstGeneration = !hasLastPlan && !hasCurrentPlan && !hasNextPlan

  // Preferences data for the generation screen
  const preferencesData: HouseholdPreferencesData = {
    dietaryType: (preferences?.dietaryType as HouseholdPreferencesData['dietaryType']) ?? null,
    allergensToAvoid:
      (preferences?.allergensToAvoid as HouseholdPreferencesData['allergensToAvoid']) ?? [],
    restrictions: preferences?.restrictions ?? [],
    weekdayMealTypes: (preferences?.weekdayMealTypes ?? ['dinner']) as MealType[],
    weekendMealTypes: (preferences?.weekendMealTypes ?? ['dinner']) as MealType[],
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        <WeekTabs
          activeWeek={activeWeek}
          currentWeekDays={isCurrentlySunday ? 0 : currentWeekDays}
          hasLastPlan={hasLastPlan}
          hasCurrentPlan={hasCurrentPlan}
          hasNextPlan={hasNextPlan}
        />

        {plan ? (
          <WeekView
            plan={plan}
            householdSize={householdSize}
            weekContext={weekContext}
            timezone={membership.household.timezone}
            isReadOnly={isReadOnly}
            pantryIngredients={pantryIngredients}
            pantryItems={pantryItems}
            expectedMealTypes={expectedMealTypes}
          />
        ) : (
          <EmptyPlan
            weekContext={weekContext}
            isFirstGeneration={isFirstGeneration}
            preferences={preferencesData}
            timezone={membership.household.timezone}
          />
        )}
      </div>
    </div>
  )
}
