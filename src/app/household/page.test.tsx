import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HouseholdPage from './page'
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
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

// Both children are client components (react-query, form state). Stub them: the
// page's own contract is the page title, and each child's internal heading
// relationship is covered by its own test file.
vi.mock('./household/HouseholdSettingsForm', () => ({
  HouseholdSettingsForm: () => <div data-testid="household-settings-form" />,
}))

vi.mock('@/components/household/MemberList', () => ({
  MemberList: () => <div data-testid="member-list" />,
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

async function mockSignedIn() {
  const { auth } = await import('@/lib/auth')
  const { getHouseholdMembership } = await import('@/lib/household')
  vi.mocked(auth.api.getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue(membership as never)
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

    render(await HouseholdPage())

    expect(screen.getByRole('heading', { name: 'Household', level: 1 })).toBeInTheDocument()
  })

  it('renders the page title at the Title level, not the h1 variant', async () => {
    await mockSignedIn()

    render(await HouseholdPage())

    const title = screen.getByRole('heading', { name: 'Household', level: 1 })
    expect(title).toHaveClass('text-xl', 'font-semibold')
    expect(title).not.toHaveClass('text-4xl')
  })

  it('renders both columns for an owner', async () => {
    await mockSignedIn()

    render(await HouseholdPage())

    expect(screen.getByTestId('household-settings-form')).toBeInTheDocument()
    expect(screen.getByTestId('member-list')).toBeInTheDocument()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)

    await expect(HouseholdPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in')
    expect(getHouseholdMembership).not.toHaveBeenCalled()
  })

  it('redirects home when the user has no household', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(HouseholdPage()).rejects.toThrow('NEXT_REDIRECT:/')
  })
})
