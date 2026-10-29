import { Separator } from '@/components/ui/separator'
import { Body, Heading, Li, Ol } from '@/components/ui/typography'
import { listApiKeys } from '@/lib/api-keys'
import { getServerBaseURL } from '@/lib/env'
import { listMcpConsents } from '@/lib/mcp/consents'
import { getMcpResource } from '@/lib/mcp/oauth'

import { accountTabMetadata, requireAccountMember } from '../account-member'
import { ApiKeysSection } from './ApiKeysSection'
import { ConnectedAssistantsList } from './ConnectedAssistantsList'
import { McpServerUrl } from './McpServerUrl'

/** The source of truth for the Claude steps, which move when Claude's menus do. */
const CLAUDE_CONNECTOR_HELP_URL =
  'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp'

export function generateMetadata() {
  return accountTabMetadata('connections')
}

/** My account → Connections: AI assistants, then screens and scripts (HON-1229). */
export default async function AccountConnectionsPage() {
  const { session, membership, t } = await requireAccountMember()

  const isOwner = membership.role === 'owner'
  // The owner sees every member's API keys, a member their own (HON-1221).
  const [consents, apiKeys] = await Promise.all([
    listMcpConsents(session.user.id),
    listApiKeys({
      userId: session.user.id,
      householdId: isOwner ? membership.householdId : null,
    }),
  ])

  return (
    <div className="flex flex-col gap-6">
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
                  className="inline-link"
                >
                  {chunks}
                </a>
              ),
            })}
          </Body>
        </div>
        <ConnectedAssistantsList
          initialConsents={consents}
          timeZone={membership.household.timezone}
        />
      </section>

      <Separator />

      {/* Read-only keys for a kitchen screen or a script (HON-1220). */}
      <ApiKeysSection
        initialKeys={apiKeys}
        timeZone={membership.household.timezone}
        householdView={isOwner}
        baseUrl={getServerBaseURL()}
      />
    </div>
  )
}
