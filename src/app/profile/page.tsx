import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { Heading, Body } from '@/components/ui/typography'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { DeleteAccountDialog } from './DeleteAccountDialog'

export default async function ProfilePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  // Redirect users without a household to onboarding
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    redirect('/onboarding')
  }

  const memberCount = await getHouseholdMemberCount(membership.householdId)
  const isOwner = membership.role === 'owner'

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
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
          <div className="flex flex-col gap-6">
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
            </div>

            <Separator />

            <div className="flex flex-col gap-3">
              <Heading variant="h4">Danger zone</Heading>
              <Body variant="muted">Permanently delete your account and all associated data.</Body>
              <div>
                <DeleteAccountDialog
                  userEmail={session.user.email}
                  householdName={membership.household.name}
                  isOwner={isOwner}
                  memberCount={memberCount}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
