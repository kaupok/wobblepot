import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Home from './page'
import enMessages from '../../messages/en.json'

// Resolve `getTranslations('landing')` → (key) → en.json.landing[key] so the
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

// Mock the auth module to prevent database initialization
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

// Mock the household module
vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

// Mock Next.js headers
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
}))

// Mock the timeline components since they require complex client-side behavior
vi.mock('@/components/timeline', () => ({
  TimelineView: vi.fn(() => <div data-testid="timeline-view">Timeline</div>),
  FirstTimeSetup: vi.fn(() => <div data-testid="first-time-setup">First Time Setup</div>),
}))

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('Home page component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock responses for fetch
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    })
  })

  it('renders landing page heading when not authenticated', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Home()
    render(component)
    expect(
      screen.getByRole('heading', { name: 'Meal planning for busy families' }),
    ).toBeInTheDocument()
  })

  it('renders value proposition when not authenticated', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Home()
    render(component)
    expect(
      screen.getByText(/AI-powered weekly meal plans tailored to your household/),
    ).toBeInTheDocument()
  })

  it('renders feature bullets when not authenticated', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Home()
    render(component)
    expect(screen.getByText('Personalized for your household')).toBeInTheDocument()
    expect(screen.getByText('Smart shopping lists')).toBeInTheDocument()
    expect(screen.getByText('Tracks what you have on hand')).toBeInTheDocument()
  })

  it('renders CTA button linking to sign-up when not authenticated', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Home()
    render(component)
    const ctaLink = screen.getByRole('link', { name: "Get started - it's free" })
    expect(ctaLink).toBeInTheDocument()
    expect(ctaLink).toHaveAttribute('href', '/sign-up')
  })

  it('renders first-time setup when authenticated with household but no entries', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    const now = new Date()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {
        id: 'session-123',
        userId: '123',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        token: 'test-token',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    vi.mocked(getHouseholdMembership).mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: '123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: 'Test Household',
        timezone: 'Europe/Tallinn',
        createdAt: now,
        preferences: null,
        // The page reads the household size off this `_count` (HON-596).
        _count: { members: 2 },
      },
    } as never)

    // Mock entries response: no entries, no plan
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/entries')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ entries: [], planId: null }),
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })

    const component = await Home()
    render(component)
    expect(screen.getByTestId('first-time-setup')).toBeInTheDocument()
  })

  it('renders timeline view when authenticated with household and entries', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    const now = new Date()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {
        id: 'session-123',
        userId: '123',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        token: 'test-token',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    vi.mocked(getHouseholdMembership).mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: '123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: 'Test Household',
        timezone: 'Europe/Tallinn',
        createdAt: now,
        preferences: null,
        // The page reads the household size off this `_count` (HON-596).
        _count: { members: 2 },
      },
    } as never)

    // Mock entries response: has entries
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/entries')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            entries: [
              {
                id: 'entry-1',
                date: '2026-03-29',
                mealType: 'dinner',
                status: 'planned',
                rating: null,
                meal: { id: 'meal-1', name: 'Chicken Rice', components: [], nutrition: {} },
                preparationTips: null,
                note: null,
                servingOverride: null,
              },
            ],
            planId: 'plan-1',
          }),
        })
      }
      if (url.includes('/api/pantry')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        })
      }
      if (url.includes('/api/shopping-list')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ groups: [], summary: {} }),
        })
      }
      if (url.includes('/api/households/me/preferences')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ weekdayMealTypes: ['dinner'], weekendMealTypes: ['dinner'] }),
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })

    const component = await Home()
    render(component)
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument()
  })

  it('redirects to onboarding when authenticated without household', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    const now = new Date()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {
        id: 'session-123',
        userId: '123',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        token: 'test-token',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(Home()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })
})
