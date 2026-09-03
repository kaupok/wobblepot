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
    return (key: string) => (cursor as Record<string, string>)?.[key] ?? key
  }),
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

// The dialog is a client component with Radix internals. Surface the props the
// page hands it as data attributes — `memberCount` is the value HON-596 moved
// from a second DB round-trip onto the membership query's `_count`.
vi.mock('./DeleteAccountDialog', () => ({
  DeleteAccountDialog: ({
    userEmail,
    householdName,
    isOwner,
    memberCount,
  }: {
    userEmail: string
    householdName?: string
    isOwner?: boolean
    memberCount?: number
  }) => (
    <div
      data-testid="delete-account-dialog"
      data-user-email={userEmail}
      data-household-name={householdName}
      data-is-owner={String(isOwner)}
      data-member-count={String(memberCount)}
    />
  ),
}))

const now = new Date()

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the member count from the membership query to the delete dialog', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(4) as never)

    render(await ProfilePage())

    const dialog = screen.getByTestId('delete-account-dialog')
    expect(dialog).toHaveAttribute('data-member-count', '4')
    expect(dialog).toHaveAttribute('data-household-name', 'Doe Family')
    expect(dialog).toHaveAttribute('data-is-owner', 'true')
    expect(dialog).toHaveAttribute('data-user-email', 'test@example.com')

    // The whole point of HON-596: the count rides along on the membership
    // query, so the page issues exactly one `household_member` read.
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

    const pending = ProfilePage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // `getTranslations` is not DB-free — next-intl's request config resolves
    // `getLocale()`, which reads `household_member`. It must not sit behind the
    // membership query (HON-596 review).
    expect(getTranslations).toHaveBeenCalledWith('profile')

    resolveMembership(membershipWithMemberCount(3))
    render(await pending)
    expect(screen.getByTestId('delete-account-dialog')).toHaveAttribute('data-member-count', '3')
  })

  it('marks a non-owner membership as such', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue({
      ...membershipWithMemberCount(1),
      role: 'member',
    } as never)

    render(await ProfilePage())

    const dialog = screen.getByTestId('delete-account-dialog')
    expect(dialog).toHaveAttribute('data-is-owner', 'false')
    expect(dialog).toHaveAttribute('data-member-count', '1')
  })

  it('renders the signed-in user name and email', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2) as never)

    render(await ProfilePage())

    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(ProfilePage()).rejects.toThrow('NEXT_REDIRECT:/sign-in')
    expect(getHouseholdMembership).not.toHaveBeenCalled()
  })

  it('redirects to onboarding when the user has no household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(ProfilePage()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })
})
