import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { RecipeImportClient } from './RecipeImportClient'

export default async function RecipeImportPage() {
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

  // The member count the parser falls back to when a recipe does not say how
  // many it serves, the same start the blank form uses (HON-1363).
  return <RecipeImportClient defaultServings={membership.household._count.members} />
}
