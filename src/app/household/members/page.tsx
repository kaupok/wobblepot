import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { MemberList } from '@/components/household/MemberList'

export default async function MembersPage() {
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
  const currentMemberId = membership.id
  const householdDietaryType = membership.household.preferences?.dietaryType ?? null

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <MemberList
        isOwner={isOwner}
        currentMemberId={currentMemberId}
        householdDietaryType={householdDietaryType}
      />
    </div>
  )
}
