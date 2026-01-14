import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { InviteList } from '@/components/settings/InviteList'

export default async function InviteSettingsPage() {
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

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <InviteList isOwner={isOwner} />
    </div>
  )
}
