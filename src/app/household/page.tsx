import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { Heading } from '@/components/ui/typography'
import { HouseholdSettingsForm } from './household/HouseholdSettingsForm'
import { MemberList } from '@/components/household/MemberList'

export default async function HouseholdPage() {
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
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Heading>Household</Heading>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left column: Household settings */}
        <div>
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

        {/* Right column: Members */}
        <div>
          <MemberList isOwner={isOwner} currentMemberId={membership.id} />
        </div>
      </div>
    </div>
  )
}
