import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import HouseholdMembersPage, { generateMetadata } from './page'
import HouseholdLayout from './layout'
import { createQueryWrapper } from '@/test/query-wrapper'
import { accountSession as session, membershipWithMemberCount } from '@/test/account-page'
import { MEMBERS_QUERY_KEY, type MembersResponse } from '@/components/household/members-query'
import enMessages from '../../../messages/en.json'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/account-page')).catalogTranslations),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
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

vi.mock('./HouseholdTabs', () => ({
  HouseholdTabs: () => <nav aria-label="Household sections" />,
}))

// The stub reads the members the page dehydrated, straight from the client
// cache under the key `MemberList` queries — the same lookup that lets the real
// component skip its first fetch (HON-780). Its own title level is pinned at
// `level: 2` in `MemberList.test.tsx`.
vi.mock('@/components/household/MemberList', () => ({
  MemberList: function MemberListStub(props: { isOwner: boolean; currentMemberId: string }) {
    const data = useQueryClient().getQueryData<MembersResponse>(MEMBERS_QUERY_KEY)
    return (
      <div
        data-testid="member-list"
        data-owner={String(props.isOwner)}
        data-current={props.currentMemberId}
      >
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

async function mockSignedIn(role: 'owner' | 'member' = 'owner') {
  const { getSession } = await import('@/lib/session')
  const { getHouseholdMembership, listHouseholdMembers } = await import('@/lib/household')
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2, role) as never)
  vi.mocked(listHouseholdMembers).mockResolvedValue(members as never)
}

async function renderPage() {
  const { wrapper } = createQueryWrapper()
  render(await HouseholdLayout({ children: await HouseholdMembersPage() }), { wrapper })
}

describe('HouseholdMembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Members · Household' })
  })

  /**
   * The two halves of HON-618 are asserted separately because they fail
   * independently. The tag is the outline anchor every tab hangs off — each
   * section renders an `as="h2"` title (HON-960) — so dropping `as="h1"`
   * would let the title render `<h4>` and invert everything under it. The
   * size is the `docs/DESIGN.md` rule ("page titles above `text-xl` inside
   * the app" is on the reject list).
   *
   * Neither is visible to axe: `heading-order` sees one `<h1>` either way, and
   * no a11y rule has an opinion about font size.
   */
  it('renders the layout title as the h1 that anchors the outline', async () => {
    await mockSignedIn()

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Household', level: 1 })).toBeInTheDocument()
  })

  it('renders the layout title at the Title level, not the h1 variant', async () => {
    await mockSignedIn()

    await renderPage()

    const title = screen.getByRole('heading', { name: 'Household', level: 1 })
    expect(title).toHaveClass('text-xl', 'font-semibold')
    expect(title).not.toHaveClass('text-4xl')
  })

  // The list is short and sits in the form column every tab shares, so the
  // page keeps one right edge (HON-1020).
  it('renders the title, the tabs, then the member list, in one max-w-2xl column', async () => {
    await mockSignedIn()

    await renderPage()

    const title = screen.getByRole('heading', { name: 'Household', level: 1 })
    const tabs = screen.getByRole('navigation', { name: 'Household sections' })
    const memberList = screen.getByTestId('member-list')
    expect(title.parentElement).toBe(memberList.parentElement)
    expect(Array.from(title.parentElement!.children)).toEqual([title, tabs, memberList])
    expect(memberList.parentElement).toHaveClass('max-w-2xl')
  })

  it('renders no settings form and no Leave household', async () => {
    await mockSignedIn()

    await renderPage()

    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Leave household' })).not.toBeInTheDocument()
  })

  it.each(['owner', 'member'] as const)(
    "passes a %s's role and member row to the list",
    async (role) => {
      await mockSignedIn(role)

      await renderPage()

      const list = screen.getByTestId('member-list')
      expect(list).toHaveAttribute('data-owner', String(role === 'owner'))
      expect(list).toHaveAttribute('data-current', 'member-123')
    },
  )

  // A member can edit their own row here, so the notice would be wrong (HON-960).
  it('shows a member no owner-only notice', async () => {
    await mockSignedIn('member')

    await renderPage()

    expect(
      screen.queryByText(enMessages.household.settings.ownerOnlyNotice),
    ).not.toBeInTheDocument()
  })

  it('prefetches the members so the Members list needs no client fetch', async () => {
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
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(HouseholdMembersPage()).rejects.toThrow(/^NEXT_REDIRECT:\/sign-in$/)
    expect(getHouseholdMembership).not.toHaveBeenCalled()
  })

  it('redirects home when the user has no household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    // Anchored: `toThrow(string)` is a substring match, and every redirect
    // target starts with `/`, so the plain-string form would also pass on
    // `/sign-in` or `/onboarding` (PR #702 review).
    await expect(HouseholdMembersPage()).rejects.toThrow(/^NEXT_REDIRECT:\/$/)
  })
})
