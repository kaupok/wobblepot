import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { MemberPreferencesForm } from './MemberPreferencesForm'

export default async function MemberPreferencesPage() {
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

  // Get or create member preferences
  let preferences = await prisma.memberPreferences.findUnique({
    where: { memberId: membership.id },
  })

  if (!preferences) {
    preferences = await prisma.memberPreferences.create({
      data: { memberId: membership.id },
    })
  }

  const householdDietaryType =
    membership.household.preferences?.dietaryType ?? null

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <MemberPreferencesForm
        preferences={{
          displayName: preferences.displayName,
          portionMultiplier: preferences.portionMultiplier,
          targetCalories: preferences.targetCalories,
          targetProtein: preferences.targetProtein,
          targetCarbs: preferences.targetCarbs,
          targetFat: preferences.targetFat,
          dietaryType: preferences.dietaryType,
          restrictions: preferences.restrictions,
          excludedIngredients: preferences.excludedIngredients,
        }}
        householdDietaryType={householdDietaryType}
      />
    </div>
  )
}
