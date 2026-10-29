import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accountSession as session, membershipWithMemberCount } from '@/test/account-page'

import AccountLayout from '../layout'
import AccountConnectionsPage, { generateMetadata } from './page'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/account-page')).catalogTranslations),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('../AccountTabs', () => ({
  AccountTabs: () => <nav aria-label="Account sections" />,
}))

vi.mock('./McpServerUrl', () => ({
  McpServerUrl: ({ url }: { url: string }) => <div data-testid="mcp-server-url" data-url={url} />,
}))

vi.mock('./ConnectedAssistantsList', () => ({
  ConnectedAssistantsList: ({
    initialConsents,
    timeZone,
  }: {
    initialConsents: unknown[]
    timeZone: string
  }) => (
    <div
      data-testid="connected-assistants"
      data-count={String(initialConsents.length)}
      data-time-zone={timeZone}
    />
  ),
}))

vi.mock('./ApiKeysSection', () => ({
  ApiKeysSection: ({
    initialKeys,
    timeZone,
    householdView,
    baseUrl,
  }: {
    initialKeys: unknown[]
    timeZone: string
    householdView: boolean
    baseUrl: string
  }) => (
    <div
      data-testid="api-keys-section"
      data-count={String(initialKeys.length)}
      data-time-zone={timeZone}
      data-household-view={String(householdView)}
      data-base-url={baseUrl}
    />
  ),
}))

vi.mock('@/lib/mcp/consents', () => ({
  listMcpConsents: vi.fn(async () => []),
}))

vi.mock('@/lib/api-keys', () => ({
  listApiKeys: vi.fn(async () => []),
}))

vi.mock('@/lib/env', () => ({
  getServerBaseURL: () => 'https://wobblepot.test',
}))

async function signedIn(role: 'owner' | 'member' = 'owner') {
  const { getSession } = await import('@/lib/session')
  const { getHouseholdMembership } = await import('@/lib/household')
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(1, role) as never)
}

describe('AccountConnectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Connections · My account' })
  })

  it('shows the MCP server URL for this environment, the Claude steps and the connected assistants', async () => {
    const { listMcpConsents } = await import('@/lib/mcp/consents')
    await signedIn()
    vi.mocked(listMcpConsents).mockResolvedValue([
      { clientId: 'c1', clientName: 'Claude', scopes: ['mcp:read'], createdAt: null },
    ])

    render(await AccountConnectionsPage())

    expect(
      screen.getByRole('heading', { level: 2, name: 'Connect to an AI assistant' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('mcp-server-url')).toHaveAttribute(
      'data-url',
      'https://wobblepot.test/api/mcp',
    )
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'In Claude, open Connectors and choose Add custom connector.',
      'Paste the server URL and add the connector.',
      'Sign in to Wobblepot and choose Allow.',
    ])
    expect(
      screen.getByRole('link', { name: "Claude's guide to custom connectors" }),
    ).toHaveAttribute('href', expect.stringContaining('support.claude.com'))
    expect(listMcpConsents).toHaveBeenCalledWith('user-123')
    const assistants = screen.getByTestId('connected-assistants')
    expect(assistants).toHaveAttribute('data-count', '1')
    expect(assistants).toHaveAttribute('data-time-zone', 'Europe/Tallinn')
  })

  // HON-1220: "Screens and scripts" follows the assistants.
  it("passes the user's API keys to the section after the assistants", async () => {
    const { listApiKeys } = await import('@/lib/api-keys')
    await signedIn()
    vi.mocked(listApiKeys).mockResolvedValue([
      {
        id: 'key-1',
        name: 'Kitchen screen',
        start: 'wp_abcdef',
        createdAt: '2026-10-14T10:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        expired: false,
        memberName: 'Jane',
      },
    ])

    render(await AccountConnectionsPage())

    const section = screen.getByTestId('api-keys-section')
    expect(section).toHaveAttribute('data-count', '1')
    expect(section).toHaveAttribute('data-time-zone', 'Europe/Tallinn')
    // HON-1221: the owner gets the household's keys.
    expect(section).toHaveAttribute('data-household-view', 'true')
    // HON-1228: "Use the key" shows this host's endpoint URLs.
    expect(section).toHaveAttribute('data-base-url', 'https://wobblepot.test')
    expect(listApiKeys).toHaveBeenCalledWith({ userId: 'user-123', householdId: 'household-123' })
    expect(
      screen.getByTestId('connected-assistants').compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('passes a member only their own API keys (HON-1221)', async () => {
    const { listApiKeys } = await import('@/lib/api-keys')
    await signedIn('member')

    render(await AccountConnectionsPage())

    expect(screen.getByTestId('api-keys-section')).toHaveAttribute('data-household-view', 'false')
    expect(listApiKeys).toHaveBeenCalledWith({ userId: 'user-123', householdId: null })
  })

  // HON-1229: the profile and the data have tabs of their own.
  it('shows nothing from the Profile or Your data tabs', async () => {
    await signedIn()

    render(await AccountConnectionsPage())

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Connect to an AI assistant',
      'Connect Claude',
    ])
    expect(screen.queryByText('test@example.com')).toBeNull()
  })

  it('renders its section one level below the layout title', async () => {
    await signedIn()

    render(await AccountLayout({ children: await AccountConnectionsPage() }))

    const title = screen.getByRole('heading', { name: 'My account', level: 1 })
    const titleLevel = Number(title.tagName.slice(1))

    expect(
      screen.getByRole('heading', { name: 'Connect to an AI assistant', level: titleLevel + 1 }),
    ).toBeInTheDocument()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(AccountConnectionsPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in')
  })

  it('redirects to onboarding when the user has no household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    const { listApiKeys } = await import('@/lib/api-keys')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(AccountConnectionsPage()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
    expect(listApiKeys).not.toHaveBeenCalled()
  })
})
