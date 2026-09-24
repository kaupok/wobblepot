import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import HouseholdPage from './page'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MEMBERS_QUERY_KEY, type MembersResponse } from '@/components/household/members-query'
import enMessages from '../../../messages/en.json'

// Resolve `getTranslations('household')` → (key) → en.json.household[key] so the
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

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
  listHouseholdMembers: vi.fn(),
}))

// Under jsdom `getQueryClient` would hand back its browser singleton, so the
// cache would leak between tests; the server path makes a fresh one per request.
vi.mock('@/lib/get-query-client', () => ({
  getQueryClient: vi.fn(() => new QueryClient()),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

// Both children are client components (react-query, form state). Stub them: the
// page's own contract is the page title. Each child's own title level is
// asserted in its colocated test — `HouseholdSettingsForm.test.tsx` and
// `MemberList.test.tsx` both pin it at `level: 2`, one below the h1 here.
vi.mock('./household/HouseholdSettingsForm', () => ({
  HouseholdSettingsForm: () => <div data-testid="household-settings-form" />,
}))

// The stub reads the members the page dehydrated, straight from the client
// cache under the key `MemberList` queries — the same lookup that lets the real
// component skip its first fetch (HON-780).
vi.mock('@/components/household/MemberList', () => ({
  MemberList: function MemberListStub() {
    const data = useQueryClient().getQueryData<MembersResponse>(MEMBERS_QUERY_KEY)
    return (
      <div data-testid="member-list">
        {data ? (
          <ul>
            {data.members.map((member) => (
              <li key={member.id}>
                {member.name ?? member.user?.name}, joined {member.joinedAt}
              </li>
            ))}
          </ul>
        ) : (
          <span>no prefetched members</span>
        )}
      </div>
    )
  },
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

const membership = {
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
    _count: { members: 2 },
  },
}

const joinedAt = new Date('2026-01-02T03:04:05.000Z')

const members = [
  {
    id: 'member-123',
    userId: 'user-123',
    name: null,
    role: 'owner',
    joinedAt,
    user: { id: 'user-123', name: 'Test User', email: 'test@example.com', image: null },
    preferences: null,
    invite: null,
  },
]

async function mockSignedIn() {
  const { auth } = await import('@/lib/auth')
  const { getHouseholdMembership, listHouseholdMembers } = await import('@/lib/household')
  vi.mocked(auth.api.getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue(membership as never)
  vi.mocked(listHouseholdMembers).mockResolvedValue(members as never)
}

async function renderPage() {
  const { wrapper } = createQueryWrapper()
  render(await HouseholdPage(), { wrapper })
}

describe('HouseholdPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * The two halves of HON-618 are asserted separately because they fail
   * independently. The tag is the outline anchor the rest of the page hangs
   * off — `HouseholdSettingsForm` and `MemberList` render `as="h2"` titles, and
   * the form's sections `as="h3"` below those — so dropping `as="h1"` would let
   * the title render `<h4>` and invert everything under it. The size is the
   * `docs/DESIGN.md` rule ("page titles above `text-xl` inside the app" is on
   * the reject list), which a `Heading` with no `variant` silently violated by
   * falling through to the `h1` default's `text-4xl`.
   *
   * Neither is visible to axe: `heading-order` sees one `<h1>` either way, and
   * no a11y rule has an opinion about font size.
   */
  it('renders the page title as the h1 that anchors the outline', async () => {
    await mockSignedIn()

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Household', level: 1 })).toBeInTheDocument()
  })

  it('renders the page title at the Title level, not the h1 variant', async () => {
    await mockSignedIn()

    await renderPage()

    const title = screen.getByRole('heading', { name: 'Household', level: 1 })
    expect(title).toHaveClass('text-xl', 'font-semibold')
    expect(title).not.toHaveClass('text-4xl')
  })

  it('renders both columns for an owner', async () => {
    await mockSignedIn()

    await renderPage()

    expect(screen.getByTestId('household-settings-form')).toBeInTheDocument()
    expect(screen.getByTestId('member-list')).toBeInTheDocument()
  })

  it('prefetches the members so the Members column needs no client fetch', async () => {
    await mockSignedIn()
    const { listHouseholdMembers } = await import('@/lib/household')

    await renderPage()

    expect(listHouseholdMembers).toHaveBeenCalledWith('household-123')
    // `joinedAt` arrives as the ISO string `apiFetch` would produce, not a
    // `Date`: the hydrated cache has to match the route's wire shape.
    expect(screen.getByText(`Test User, joined ${joinedAt.toISOString()}`)).toBeInTheDocument()
  })

  it('still renders when the prefetch fails, leaving the fetch to the client', async () => {
    await mockSignedIn()
    const { listHouseholdMembers } = await import('@/lib/household')
    vi.mocked(listHouseholdMembers).mockRejectedValue(new Error('db down'))

    await renderPage()

    expect(listHouseholdMembers).toHaveBeenCalledTimes(1)
    expect(screen.getByText('no prefetched members')).toBeInTheDocument()
    expect(screen.getByTestId('household-settings-form')).toBeInTheDocument()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)

    await expect(HouseholdPage()).rejects.toThrow(/^NEXT_REDIRECT:\/sign-in$/)
    expect(getHouseholdMembership).not.toHaveBeenCalled()
  })

  it('redirects home when the user has no household', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    // Anchored: `toThrow(string)` is a substring match, and every redirect
    // target in this page starts with `/`, so the plain-string form would also
    // pass on `/sign-in` or `/onboarding` (PR #702 review).
    await expect(HouseholdPage()).rejects.toThrow(/^NEXT_REDIRECT:\/$/)
  })
})
