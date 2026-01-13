import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { getServerBaseURL } from '@/lib/env'
import { WeekView } from '@/components/meal-plan/WeekView'
import { EmptyPlan } from '@/components/meal-plan/EmptyPlan'
import type { MealPlan } from '@/components/meal-plan/types'

export default async function DashboardPage() {
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

  // Fetch household size and current meal plan in parallel
  const requestHeaders = await headers()
  const baseURL = getServerBaseURL()

  const [householdSize, response] = await Promise.all([
    getHouseholdMemberCount(membership.household.id),
    fetch(`${baseURL}/api/meal-plans/current`, {
      headers: {
        cookie: requestHeaders.get('cookie') ?? '',
      },
      cache: 'no-store',
    }),
  ])

  // No current plan - show empty state
  if (response.status === 404) {
    return (
      <div className="container mx-auto px-4 py-8">
        <EmptyPlan />
      </div>
    )
  }

  // Handle errors
  if (!response.ok) {
    throw new Error('Failed to fetch meal plan')
  }

  const plan: MealPlan = await response.json()

  return (
    <div className="container mx-auto px-4 py-8">
      <WeekView plan={plan} householdSize={householdSize} />
    </div>
  )
}
