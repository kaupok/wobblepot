import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { countAccountHoldingMembers, getHouseholdMembership } from '@/lib/household'
import { Heading, Body, Ol, Li } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { ProfileNameForm } from './ProfileNameForm'
import { ChangePasswordForm } from './ChangePasswordForm'
import { ConnectedAssistantsList } from './ConnectedAssistantsList'
import { McpServerUrl } from './McpServerUrl'
import { VerifyEmailNotice } from './VerifyEmailNotice'
import { parseVerificationLanding } from '@/lib/email-verification'
import { getServerBaseURL } from '@/lib/env'
import { listMcpConsents } from '@/lib/mcp/consents'
import { getMcpResource } from '@/lib/mcp/oauth'

/** The source of truth for the Claude steps, which move when Claude's menus do. */
const CLAUDE_CONNECTOR_HELP_URL =
  'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp'

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // `getSession` is `cache()`-wrapped, so this reuses the lookup the root
  // layout already resolved for this request rather than re-reading `session`.
  const session = await getSession()

  if (!session) {
    redirect('/sign-in')
  }

  // `getTranslations` is not DB-free: it resolves next-intl's request config,
  // whose `getLocale()` reads `getCachedMembership()`. The root layout warms
  // that `cache()` entry, but the page renders concurrently with the layout
  // rather than after it, so overlap it with the membership read instead of
  // assuming it is already resolved. Both are awaited before the redirect, so
  // the auth gate's ordering is unchanged.
  const [membership, t, consents, params] = await Promise.all([
    getHouseholdMembership(session.user.id),
    getTranslations('profile'),
    listMcpConsents(session.user.id),
    searchParams,
  ])

  // Redirect users without a household to onboarding
  if (!membership) {
    redirect('/onboarding')
  }

  const isOwner = membership.role === 'owner'
  // Only an owner's dialog reads this: members with an account are the ones
  // that block deletion, and members without one are deleted with the
  // household (HON-881). Not `household._count.members`, which counts every
  // member row — the household size — and would block an owner whose other
  // members are all children added by name. Skipped for non-owners.
  const accountMemberCount = isOwner
    ? await countAccountHoldingMembers(membership.householdId)
    : undefined

  return (
    <div className="w-full px-4 py-8">
      {/* A form page: a narrow column, top-aligned, no page-level Card (HON-767). */}
      <div className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Heading variant="h4" as="h1">
            {t('title')}
          </Heading>
          <Body variant="muted">{t('description')}</Body>
        </div>

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
            landing={parseVerificationLanding(params)}
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

        <Separator />

        {/* Every household gets this; there is no flag (HON-1153). */}
        <section aria-labelledby="ai-assistant-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <Heading variant="section" as="h2" id="ai-assistant-heading">
              {t('assistants.heading')}
            </Heading>
            <Body variant="muted">{t('assistants.description')}</Body>
            <McpServerUrl url={getMcpResource(getServerBaseURL())} />
          </div>
          <div className="flex flex-col gap-2">
            <Heading variant="section" as="h3">
              {t('assistants.stepsHeading')}
            </Heading>
            <Ol>
              <Li>{t('assistants.steps.openConnectors')}</Li>
              <Li>{t('assistants.steps.pasteUrl')}</Li>
              <Li>{t('assistants.steps.allow')}</Li>
            </Ol>
            <Body variant="muted">
              {t.rich('assistants.help', {
                link: (chunks) => (
                  <a
                    href={CLAUDE_CONNECTOR_HELP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </Body>
          </div>
          <ConnectedAssistantsList initialConsents={consents} />
        </section>

        <Separator />

        <div className="flex flex-col gap-3">
          <Heading variant="section" as="h2">
            {t('yourDataHeading')}
          </Heading>
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
          <Heading variant="section" as="h2">
            {t('dangerHeading')}
          </Heading>
          <Body variant="muted">{t('dangerDescription')}</Body>
          <div>
            <DeleteAccountDialog
              userEmail={session.user.email}
              householdName={membership.household.name}
              isOwner={isOwner}
              accountMemberCount={accountMemberCount}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
