import { Heading, Body } from '@/components/ui/typography'
import { Separator } from '@/components/ui/separator'
import { ProfileNameForm } from './ProfileNameForm'
import { ChangePasswordForm } from './ChangePasswordForm'
import { SetPassword } from './SetPassword'
import { SignInMethods } from './SignInMethods'
import { VerifyEmailNotice } from '@/components/VerifyEmailNotice'
import { parseVerificationLanding } from '@/lib/email-verification'
import { hasPasswordAccount, parseGoogleLinkLanding } from '@/lib/sign-in-methods'
import { getSignInAccounts } from '@/lib/session'
import { isGoogleAuthConfigured } from '@/lib/env'
import { accountTabMetadata, requireAccountMember } from './account-member'

export function generateMetadata() {
  return accountTabMetadata('profile')
}

/**
 * My account → Profile: name, email and its verification, sign-in methods,
 * password (HON-1229, HON-1158).
 */
export default async function AccountProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  // The Connect callback also sends `error`, so its `linked=google` claims the
  // param; otherwise a failed Connect reads as a broken verification link.
  const linkLanding = parseGoogleLinkLanding(params)
  const landing = linkLanding ? null : parseVerificationLanding(params)
  const { session, t } = await requireAccountMember({ landing })
  const accounts = await getSignInAccounts()
  // A Google-only account has no current password to type (HON-1158).
  const hasPassword = hasPasswordAccount(accounts)

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

      <SignInMethods
        initialAccounts={accounts}
        email={session.user.email}
        googleEnabled={isGoogleAuthConfigured()}
        landing={linkLanding}
      />

      <Separator />

      {hasPassword ? (
        <div className="flex flex-col gap-3">
          <Heading variant="section" as="h2">
            {t('password.heading')}
          </Heading>
          <Body variant="muted">{t('password.description')}</Body>
          <ChangePasswordForm />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Heading variant="section" as="h2">
            {t('password.googleOnly.heading')}
          </Heading>
          <Body variant="muted">{t('password.googleOnly.description')}</Body>
          <SetPassword email={session.user.email} />
        </div>
      )}
    </div>
  )
}
