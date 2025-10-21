import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { Heading, Body } from '@/components/ui/typography'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignOutButton } from './sign-out-button'

export default async function ProfilePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Profile</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">Your account information</Body>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Body variant="small" className="text-muted-foreground">
                Name
              </Body>
              <Body>{session.user.name}</Body>
            </div>
            <div className="flex flex-col gap-1">
              <Body variant="small" className="text-muted-foreground">
                Email
              </Body>
              <Body>{session.user.email}</Body>
            </div>
            <div className="pt-4">
              <SignOutButton />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
