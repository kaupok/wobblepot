import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { getServerBaseURL } from '@/lib/env'
import { getDaysRemaining, isSunday } from '@/lib/meal-planning/dates'
import { WeekView } from '@/components/meal-plan/WeekView'
import { EmptyPlan } from '@/components/meal-plan/EmptyPlan'
import { WeekTabs } from '@/components/meal-plan/WeekTabs'
import type { MealPlanWithContext, WeekContext } from '@/components/meal-plan/types'

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
  const currentWeekDays = getDaysRemaining()
  const isCurrentlySunday = isSunday()

  // Determine active week from URL param
  // On Sunday with no param, default to 'next'
  // Otherwise default to 'current'
  let activeWeek: 'current' | 'next'
  if (params.week === 'next') {
    activeWeek = 'next'
  } else if (params.week === 'current') {
    activeWeek = isCurrentlySunday ? 'next' : 'current' // Redirect Sunday to next
  } else {
    activeWeek = isCurrentlySunday ? 'next' : 'current'
  }

  // Fetch household size and both week plans in parallel
  const requestHeaders = await headers()
  const baseURL = getServerBaseURL()
  const cookieHeader = requestHeaders.get('cookie') ?? ''

  const [householdSize, currentResponse, nextResponse] = await Promise.all([
    getHouseholdMemberCount(membership.household.id),
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
  ])

  // Parse responses
  const hasCurrentPlan = currentResponse?.ok ?? false
  const hasNextPlan = nextResponse.ok

  // Get the active plan data
  const activeResponse = activeWeek === 'current' ? currentResponse : nextResponse
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

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        <WeekTabs
          activeWeek={activeWeek}
          currentWeekDays={isCurrentlySunday ? 0 : currentWeekDays}
          hasCurrentPlan={hasCurrentPlan}
          hasNextPlan={hasNextPlan}
        />

        {plan ? (
          <WeekView plan={plan} householdSize={householdSize} weekContext={weekContext} />
        ) : (
          <EmptyPlan weekContext={weekContext} />
        )}
      </div>
    </div>
  )
}
