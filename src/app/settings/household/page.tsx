import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { HouseholdSettingsForm } from './HouseholdSettingsForm'

export default async function HouseholdSettingsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    redirect('/')
  }

  const isOwner = membership.role === 'owner'
  const { household } = membership

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <HouseholdSettingsForm
        household={{
          id: household.id,
          name: household.name,
          timezone: household.timezone,
        }}
        preferences={
          household.preferences
            ? {
                dietaryType: household.preferences.dietaryType,
                allergensToAvoid: household.preferences.allergensToAvoid,
                restrictions: household.preferences.restrictions,
                excludedIngredients: household.preferences.excludedIngredients,
                weekdayMealTypes: household.preferences.weekdayMealTypes,
                weekendMealTypes: household.preferences.weekendMealTypes,
              }
            : null
        }
        isOwner={isOwner}
      />
    </div>
  )
}
