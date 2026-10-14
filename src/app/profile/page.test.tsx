import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ProfilePage from './page'
import enMessages from '../../../messages/en.json'

// Resolve `getTranslations('profile')` → (key) → en.json.profile[key] so the
// Server Component renders as if the i18n pipeline had configured a request.
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) => {
    const segments = namespace.split('.')
    let cursor: unknown = enMessages
    for (const segment of segments) {
      cursor = (cursor as Record<string, unknown>)?.[segment]
    }
    const t = (key: string) => {
      let node: unknown = cursor
      for (const segment of key.split('.')) {
        node = (node as Record<string, unknown>)?.[segment]
      }
      return typeof node === 'string' ? node : key
    }
    // Enough of `t.rich` for one `<tag>…</tag>` pair, which is all this page uses.
    t.rich = (key: string, tags: Record<string, (chunks: string) => unknown>) => {
      const match = /^(.*)<(\w+)>(.*)<\/\2>(.*)$/.exec(t(key))
      if (!match) return t(key)
      const [, before, tag, inner, after] = match
      return [before, tags[tag!]!(inner!), after]
    }
    return t
  }),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
  countAccountHoldingMembers: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

// The dialog is a client component with Radix internals. Surface the props the
// page hands it as data attributes — `accountMemberCount` counts only members
// with an account, not the household size on `_count.members` (HON-881).
vi.mock('./DeleteAccountDialog', () => ({
  DeleteAccountDialog: ({
    userEmail,
    householdName,
    isOwner,
    accountMemberCount,
  }: {
    userEmail: string
    householdName?: string
    isOwner?: boolean
    accountMemberCount?: number
  }) => (
    <div
      data-testid="delete-account-dialog"
      data-user-email={userEmail}
      data-household-name={householdName}
      data-is-owner={String(isOwner)}
      data-account-member-count={String(accountMemberCount)}
    />
  ),
}))

// The two forms are client components with their own tests; the page owns
// what it hands them.
vi.mock('./ProfileNameForm', () => ({
  ProfileNameForm: ({ initialName }: { initialName: string }) => (
    <div data-testid="profile-name-form" data-initial-name={initialName} />
  ),
}))

vi.mock('./ChangePasswordForm', () => ({
  ChangePasswordForm: () => <div data-testid="change-password-form" />,
}))

vi.mock('./McpServerUrl', () => ({
  McpServerUrl: ({ url }: { url: string }) => <div data-testid="mcp-server-url" data-url={url} />,
}))

vi.mock('./ConnectedAssistantsList', () => ({
  ConnectedAssistantsList: ({ initialConsents }: { initialConsents: unknown[] }) => (
    <div data-testid="connected-assistants" data-count={String(initialConsents.length)} />
  ),
}))

vi.mock('./ApiKeysSection', () => ({
  ApiKeysSection: ({ initialKeys, timeZone }: { initialKeys: unknown[]; timeZone: string }) => (
    <div
      data-testid="api-keys-section"
      data-count={String(initialKeys.length)}
      data-time-zone={timeZone}
    />
  ),
}))

vi.mock('@/components/VerifyEmailNotice', () => ({
  VerifyEmailNotice: ({
    email,
    emailVerified,
    landing,
  }: {
    email: string
    emailVerified: boolean
    landing: string | null
  }) => (
    <div
      data-testid="verify-email-notice"
      data-email={email}
      data-email-verified={String(emailVerified)}
      data-landing={String(landing)}
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

const now = new Date()

function props(searchParams: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(searchParams) }
}

const session = {
  session: {
    id: 'session-123',
    userId: 'user-123',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    token: 'test-token',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    createdAt: now,
    updatedAt: now,
  },
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
  },
}

function membershipWithMemberCount(members: number) {
  return {
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    name: null,
    role: 'owner',
    joinedAt: now,
    household: {
      id: 'household-123',
      name: 'Doe Family',
      timezone: 'Europe/Tallinn',
      locale: 'en',
      createdAt: now,
      preferences: null,
      _count: { members },
    },
  }
}

describe('ProfilePage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { countAccountHoldingMembers } = await import('@/lib/household')
    vi.mocked(countAccountHoldingMembers).mockResolvedValue(1)
  })

  // An owner whose household has four member rows, only two of them with an
  // account: the other two are children added by name. The dialog must get
  // the account-holding count, the one the route's guard uses, or it would
  // block a deletion the route allows (HON-881).
  it("passes the account-holding member count to an owner's delete dialog", async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership, countAccountHoldingMembers } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(4) as never)
    vi.mocked(countAccountHoldingMembers).mockResolvedValue(2)

    render(await ProfilePage(props()))

    const dialog = screen.getByTestId('delete-account-dialog')
    expect(dialog).toHaveAttribute('data-account-member-count', '2')
    expect(dialog).toHaveAttribute('data-household-name', 'Doe Family')
    expect(dialog).toHaveAttribute('data-is-owner', 'true')
    expect(dialog).toHaveAttribute('data-user-email', 'test@example.com')
    expect(countAccountHoldingMembers).toHaveBeenCalledWith('household-123')
    expect(getHouseholdMembership).toHaveBeenCalledTimes(1)
  })

  it('starts the translations lookup without waiting for the membership query', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    const { getTranslations } = await import('next-intl/server')
    vi.mocked(getSession).mockResolvedValue(session as never)

    let resolveMembership: (value: unknown) => void = () => {}
    vi.mocked(getHouseholdMembership).mockReturnValue(
      new Promise((resolve) => {
        resolveMembership = resolve
      }) as never,
    )

    const pending = ProfilePage(props())
    await new Promise((resolve) => setTimeout(resolve, 0))

    // `getTranslations` is not DB-free — next-intl's request config resolves
    // `getLocale()`, which reads `household_member`. It must not sit behind the
    // membership query (HON-596 review).
    expect(getTranslations).toHaveBeenCalledWith('profile')

    resolveMembership(membershipWithMemberCount(3))
    render(await pending)
    expect(screen.getByTestId('delete-account-dialog')).toBeInTheDocument()
  })

  it('marks a non-owner membership as such', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue({
      ...membershipWithMemberCount(1),
      role: 'member',
    } as never)

    render(await ProfilePage(props()))

    const dialog = screen.getByTestId('delete-account-dialog')
    expect(dialog).toHaveAttribute('data-is-owner', 'false')
    // Only an owner's deletion turns on the count, so a member's page skips it.
    expect(dialog).toHaveAttribute('data-account-member-count', 'undefined')
    const { countAccountHoldingMembers } = await import('@/lib/household')
    expect(countAccountHoldingMembers).not.toHaveBeenCalled()
  })

  it('hands the account name to the name form and renders the email', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2) as never)

    render(await ProfilePage(props()))

    expect(screen.getByTestId('profile-name-form')).toHaveAttribute(
      'data-initial-name',
      'Test User',
    )
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
  })

  // HON-1129: the password form sits in its own section, above "Your data".
  it('renders the change-password section before the data section', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2) as never)

    render(await ProfilePage(props()))

    const passwordHeading = screen.getByRole('heading', { name: 'Change password' })
    const dataHeading = screen.getByRole('heading', { name: 'Your data' })
    expect(screen.getByTestId('change-password-form')).toBeInTheDocument()
    expect(
      passwordHeading.compareDocumentPosition(dataHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.getByText('You stay signed in on this device. Other devices are signed out.'),
    ).toBeInTheDocument()
  })

  /**
   * The page title sits on the page background as the document's `<h1>`, at
   * the Title level of the type scale (`variant="h4"`); its sections sit
   * one level below it in the outline. See HON-619 and HON-767.
   *
   * The section level is derived from the title's tag rather than restated, so
   * moving the title moves what the loop demands — the same shape as
   * `MealForm.test.tsx` and `HouseholdSettingsForm.test.tsx`, deliberately, so
   * the three do not diverge. The `level: 1` in the title query is the separate
   * assertion that the page keeps its `<h1>`. The loop catches what axe's
   * `heading-order` cannot: that rule only flags increases greater than one, so
   * a `variant="section"` swap that forgets `as` would pass axe unnoticed.
   */
  it('renders each section one level below the page title', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2) as never)

    render(await ProfilePage(props()))

    const title = screen.getByRole('heading', { name: 'Profile', level: 1 })
    const titleLevel = Number(title.tagName.slice(1))

    for (const name of ['Change password', 'Your data', 'Danger zone']) {
      expect(screen.getByRole('heading', { name, level: titleLevel + 1 })).toBeInTheDocument()
    }
  })

  it('renders no page-level Card around the page (HON-767)', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2) as never)

    const { container } = render(await ProfilePage(props()))

    expect(container.querySelector('[data-slot="card"]')).toBeNull()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(ProfilePage(props())).rejects.toThrow('NEXT_REDIRECT:/sign-in')
    expect(getHouseholdMembership).not.toHaveBeenCalled()
  })

  it('redirects to onboarding when the user has no household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(ProfilePage(props())).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })

  // A new user often opens the verification mail before onboarding is done;
  // the result goes along to /onboarding (HON-1155).
  it.each([
    [{ verified: '1' }, '/onboarding?verified=1'],
    [{ verified: '1', error: 'TOKEN_EXPIRED' }, '/onboarding?verified=1&error=TOKEN_EXPIRED'],
    [{ verified: '1', error: 'bogus' }, '/onboarding?verified=1&error=INVALID_TOKEN'],
  ])('forwards the verification result %o to onboarding', async (params, target) => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(ProfilePage(props(params))).rejects.toThrow(`NEXT_REDIRECT:${target}`)
  })

  // HON-1220: "Screens and scripts" sits between the assistants and "Your data".
  it("passes the user's API keys to the section between the assistants and the data section", async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    const { listApiKeys } = await import('@/lib/api-keys')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(1) as never)
    vi.mocked(listApiKeys).mockResolvedValue([
      {
        id: 'key-1',
        name: 'Kitchen screen',
        start: 'wp_abcdef',
        createdAt: '2026-10-14T10:00:00.000Z',
        lastUsedAt: null,
      },
    ])

    render(await ProfilePage(props()))

    const section = screen.getByTestId('api-keys-section')
    expect(section).toHaveAttribute('data-count', '1')
    expect(section).toHaveAttribute('data-time-zone', 'Europe/Tallinn')
    expect(listApiKeys).toHaveBeenCalledWith('user-123')
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(
      screen.getByTestId('connected-assistants').compareDocumentPosition(section) & following,
    ).toBeTruthy()
    expect(
      section.compareDocumentPosition(screen.getByRole('heading', { name: 'Your data' })) &
        following,
    ).toBeTruthy()
  })

  it('shows the MCP server URL for this environment, the Claude steps and the connected assistants', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    const { listMcpConsents } = await import('@/lib/mcp/consents')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(1) as never)
    vi.mocked(listMcpConsents).mockResolvedValue([
      { clientId: 'c1', clientName: 'Claude', scopes: ['mcp:read'], createdAt: null },
    ])

    render(await ProfilePage(props()))

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
    expect(screen.getByTestId('connected-assistants')).toHaveAttribute('data-count', '1')
  })

  // The verification link lands on `/profile?verified=1`, with `&error=…` on a
  // failure (HON-1155). The page hands the notice the parsed result.
  it.each([
    [{}, 'null'],
    [{ verified: '1' }, 'verified'],
    [{ verified: '1', error: 'TOKEN_EXPIRED' }, 'expired'],
    [{ verified: '1', error: 'INVALID_TOKEN' }, 'invalid'],
  ])('hands the verification notice the state for %o', async (params, landing) => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(1) as never)

    render(await ProfilePage(props(params)))

    const notice = screen.getByTestId('verify-email-notice')
    expect(notice).toHaveAttribute('data-email', 'test@example.com')
    expect(notice).toHaveAttribute('data-email-verified', 'false')
    expect(notice).toHaveAttribute('data-landing', landing)
  })
})
