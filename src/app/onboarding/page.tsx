import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { OnboardingFlow } from './OnboardingFlow'

export default async function OnboardingPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in?returnUrl=/onboarding')
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (membership) {
    redirect('/')
  }

  return (
    // Top-anchored, not centred: a centred card moves up by half of every row
    // that step 2 adds, taking the button under the pointer with it.
    <div className="min-h-screen-below-header flex items-start justify-center px-4 pt-4 pb-16 md:pt-12">
      <OnboardingFlow userName={session.user.name} />
    </div>
  )
}
