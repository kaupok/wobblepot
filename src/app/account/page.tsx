import { Heading, Body } from '@/components/ui/typography'
import { Separator } from '@/components/ui/separator'
import { ProfileNameForm } from './ProfileNameForm'
import { ChangePasswordForm } from './ChangePasswordForm'
import { ChangeEmailForm } from './ChangeEmailForm'
import { SetPassword } from './SetPassword'
import { SignInMethods } from './SignInMethods'
import { VerifyEmailNotice } from '@/components/VerifyEmailNotice'
import { parseChangeEmailLanding, parseVerificationLanding } from '@/lib/email-verification'
import { hasPasswordAccount, parseGoogleLinkLanding } from '@/lib/sign-in-methods'
import { getSignInAccounts } from '@/lib/session'
import { isGoogleAuthConfigured } from '@/lib/env'
import { accountTabMetadata, requireAccountMember } from './account-member'

export function generateMetadata() {
  return accountTabMetadata('profile')
}

/**
 * My account → Profile: name, email with its change and verification, sign-in
 * methods, password (HON-1229, HON-1158, HON-1137).
 */
export default async function AccountProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  // The Connect callback also sends `error`, so its `linked=google` claims the
  // param; otherwise a failed Connect reads as a broken verification link.
  // The email-change link also sends `error`, under its own `emailChanged=1`.
  const linkLanding = parseGoogleLinkLanding(params)
  const changeLanding = linkLanding ? null : parseChangeEmailLanding(params)
  const landing = linkLanding || changeLanding ? null : parseVerificationLanding(params)
  // Both read only request headers, so they run together. The accounts read
  // rejects without a session; awaiting the member check first keeps its
  // redirect ahead of that rejection, and the no-op catch stops the rejection
  // going unhandled when the redirect wins.
  const accountsPromise = getSignInAccounts()
  accountsPromise.catch(() => {})
  const { session, t } = await requireAccountMember({ landing })
  const accounts = await accountsPromise
  // A Google-only account has no current password to type (HON-1158).
  const hasPassword = hasPasswordAccount(accounts)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <ProfileNameForm initialName={session.user.name} />
        {/* Google owns a Google-only account's address, so only a password account changes it (HON-1137). */}
        {hasPassword ? (
          <ChangeEmailForm email={session.user.email} landing={changeLanding} />
        ) : (
          <div className="flex flex-col gap-1">
            <Body variant="small" tone="muted">
              {t('emailLabel')}
            </Body>
            <Body>{session.user.email}</Body>
          </div>
        )}
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
