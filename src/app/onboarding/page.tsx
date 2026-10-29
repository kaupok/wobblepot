import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { VerifyEmailNotice } from '@/components/VerifyEmailNotice'
import { auth } from '@/lib/auth'
import { parseVerificationLanding } from '@/lib/email-verification'
import { getHouseholdMembership } from '@/lib/household'

import { OnboardingFlow } from './OnboardingFlow'

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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

  // The verification link lands on `/account`, which sends a user without a
  // household here with the result (HON-1155). Shown only after a landing:
  // the standing "not verified" notice belongs to `/account`.
  const landing = parseVerificationLanding(await searchParams)

  return (
    // Top-anchored, not centred: a centred card moves up by half of every row
    // that step 2 adds, taking the button under the pointer with it.
    <div className="min-h-screen-below-header flex items-start justify-center px-4 pt-4 pb-16 md:pt-12">
      <div className="flex w-full max-w-md flex-col gap-4">
        {landing && (
          <VerifyEmailNotice
            email={session.user.email}
            emailVerified={session.user.emailVerified}
            landing={landing}
          />
        )}
        <OnboardingFlow userName={session.user.name} />
      </div>
    </div>
  )
}
