import Link from 'next/link'
import { headers } from 'next/headers'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { serverEnv } from '@/lib/env'
import { auth } from '@/lib/auth'

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  return (
    <div className="grid min-h-screen place-items-center">
      <main className="flex flex-col items-center gap-8">
        <Heading>{serverEnv.NEXT_PUBLIC_APP_NAME}</Heading>

        {session ? (
          <div className="flex flex-col items-center gap-4">
            <Body>Welcome back, {session.user.name}!</Body>
            <div className="flex gap-3">
              <Button asChild>
                <Link href="/profile">View Profile</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Body variant="muted">Get started by signing in or creating an account</Body>
            <div className="flex gap-3">
              <Button asChild>
                <Link href="/sign-up">Sign Up</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/sign-in">Sign In</Link>
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
