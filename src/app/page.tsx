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
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center">
      <main className="flex flex-col items-center gap-8">
        <Heading>{serverEnv.NEXT_PUBLIC_APP_NAME}</Heading>

        {session ? (
          <div className="flex flex-col items-center gap-4">
            <Body>Welcome back, {session.user.name}!</Body>
            <div className="flex gap-3">
              <Button asChild>
                <Link href="/profile">View profile</Link>
              </Button>
            </div>
          </div>
        ) : (
          <Body variant="muted">Get started by signing in or creating an account</Body>
        )}
      </main>
    </div>
  )
}
