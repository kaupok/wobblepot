import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { CreateHouseholdForm } from './CreateHouseholdForm'

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
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <CreateHouseholdForm userName={session.user.name} />
    </div>
  )
}
