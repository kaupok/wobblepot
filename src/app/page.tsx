import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Heading, Body } from '@/components/ui/typography'
import { serverEnv } from '@/lib/env'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // Redirect authenticated users based on household membership
  if (session) {
    const membership = await getHouseholdMembership(session.user.id)
    if (!membership) {
      redirect('/onboarding')
    }
    // Redirect to dashboard if user has a household
    redirect('/dashboard')
  }

  // Landing page for unauthenticated users
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center">
      <main className="flex flex-col items-center gap-8">
        <Heading>{serverEnv.NEXT_PUBLIC_APP_NAME}</Heading>
        <Body variant="muted">Get started by signing in or creating an account</Body>
      </main>
    </div>
  )
}
