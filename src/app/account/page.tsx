import { Heading, Body } from '@/components/ui/typography'
import { Separator } from '@/components/ui/separator'
import { ProfileNameForm } from './ProfileNameForm'
import { ChangePasswordForm } from './ChangePasswordForm'
import { VerifyEmailNotice } from '@/components/VerifyEmailNotice'
import { parseVerificationLanding } from '@/lib/email-verification'
import { accountTabMetadata, requireAccountMember } from './account-member'

export function generateMetadata() {
  return accountTabMetadata('profile')
}

/** My account → Profile: name, email and its verification, password (HON-1229). */
export default async function AccountProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const landing = parseVerificationLanding(await searchParams)
  const { session, t } = await requireAccountMember({ landing })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <ProfileNameForm initialName={session.user.name} />
        <div className="flex flex-col gap-1">
          <Body variant="small" tone="muted">
            {t('emailLabel')}
          </Body>
          <Body>{session.user.email}</Body>
        </div>
        {/* The verification link lands here: `?verified=1`, or `&error=…` (HON-1155). */}
        <VerifyEmailNotice
          email={session.user.email}
          emailVerified={session.user.emailVerified}
          landing={landing}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <Heading variant="section" as="h2">
          {t('password.heading')}
        </Heading>
        <Body variant="muted">{t('password.description')}</Body>
        <ChangePasswordForm />
      </div>
    </div>
  )
}
