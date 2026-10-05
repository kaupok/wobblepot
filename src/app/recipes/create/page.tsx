import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { CreateRecipeClient } from './CreateRecipeClient'

export default async function CreateRecipePage() {
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

  // The member count, not the portions' sum (`sumPortions`), on purpose: a
  // recipe's `servings` is an integer. Its quantities are stored per serving,
  // so the household's portions still scale it when it is cooked (HON-1040).
  const memberCount = membership.household._count.members

  return <CreateRecipeClient defaultServings={memberCount} />
}
