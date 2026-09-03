import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { getHouseholdMembership } from '@/lib/household'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { DeleteAccountDialog } from './DeleteAccountDialog'

export default async function ProfilePage() {
  // `getSession` is `cache()`-wrapped, so this reuses the lookup the root
  // layout already resolved for this request rather than re-reading `session`.
  const session = await getSession()

  if (!session) {
    redirect('/sign-in')
  }

  // Redirect users without a household to onboarding
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    redirect('/onboarding')
  }

  // The member count rides along on the membership query's `_count`, so this
  // page makes a single `household_member` round-trip rather than two serial
  // ones. `getTranslations` resolves off next-intl's per-request config, which
  // the root layout has already evaluated — there is no DB read left to
  // overlap it with (HON-596).
  const t = await getTranslations('profile')
  const memberCount = membership.household._count.members
  const isOwner = membership.role === 'owner'

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading variant="h4">{t('title')}</Heading>
          <Body variant="muted">{t('description')}</Body>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Body variant="small" className="text-muted-foreground">
                  {t('nameLabel')}
                </Body>
                <Body>{session.user.name}</Body>
              </div>
              <div className="flex flex-col gap-1">
                <Body variant="small" className="text-muted-foreground">
                  {t('emailLabel')}
                </Body>
                <Body>{session.user.email}</Body>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-3">
              <Heading variant="h4">{t('yourDataHeading')}</Heading>
              <Body variant="muted">{t('yourDataDescription')}</Body>
              <div>
                <Button asChild variant="outline">
                  <a href="/api/auth/user/export" download>
                    {t('downloadButton')}
                  </a>
                </Button>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-3">
              <Heading variant="h4">{t('dangerHeading')}</Heading>
              <Body variant="muted">{t('dangerDescription')}</Body>
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
