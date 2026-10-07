import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import HouseholdPage from './page'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MEMBERS_QUERY_KEY, type MembersResponse } from '@/components/household/members-query'
import enMessages from '../../../messages/en.json'

// Resolve `getTranslations('household')` → (key) → en.json.household[key] so the
// Server Component renders as if the i18n pipeline had configured a request.
// Keys may be dotted (`settings.ownerOnlyNotice`), as next-intl allows.
function lookup(path: string): unknown {
  let cursor: unknown = enMessages
  for (const segment of path.split('.')) {
    cursor = (cursor as Record<string, unknown>)?.[segment]
  }
  return cursor
}

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) => {
    return (key: string) => {
      const value = lookup(`${namespace}.${key}`)
      return typeof value === 'string' ? value : key
    }
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

async function mockSignedIn(role: 'owner' | 'member' = 'owner') {
  const { auth } = await import('@/lib/auth')
  const { getHouseholdMembership, listHouseholdMembers } = await import('@/lib/household')
  vi.mocked(auth.api.getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue({ ...membership, role } as never)
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
   * off — `MemberList` and the form's four sections render `as="h2"` titles
   * (HON-960) — so dropping `as="h1"` would let the title render `<h4>` and
   * invert everything under it. The size is the
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

  // Members are what a household is, so they come first on every viewport
  // (HON-960). The list is short and sits above a form, so it shares the
  // settings' max-w-2xl column and the page has one right edge (HON-1020).
  it('renders the member list first, then the settings, in one max-w-2xl column', async () => {
    await mockSignedIn()

    await renderPage()

    const memberList = screen.getByTestId('member-list')
    const form = screen.getByTestId('household-settings-form')
    expect(memberList.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(memberList.parentElement).toBe(form.parentElement)
    expect(form.parentElement).toHaveClass('max-w-2xl')
    expect(memberList.closest('.lg\\:grid-cols-2')).toBeNull()
  })

  it('shows a member the owner-only notice once, under the page title', async () => {
    await mockSignedIn('member')

    await renderPage()

    // getByText throws on more than one match, so this also asserts "once".
    const notice = screen.getByText(enMessages.household.settings.ownerOnlyNotice)
    const title = screen.getByRole('heading', { name: 'Household', level: 1 })
    expect(title.nextElementSibling).toBe(notice)
  })

  it('shows the owner no owner-only notice', async () => {
    await mockSignedIn()

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
