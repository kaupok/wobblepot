import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Header } from './header'

// Mock the auth module to prevent database initialization
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

// Mock household membership check
vi.mock('@/lib/household', () => ({
  hasHouseholdMembership: vi.fn(),
}))

// Mock Next.js headers
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

// Mock HeaderActions component
vi.mock('./header-actions', () => ({
  HeaderActions: ({ session, hasHousehold }: { session: unknown; hasHousehold: boolean }) => (
    <div data-testid="header-actions">
      {session ? 'authenticated' : 'unauthenticated'}
      {hasHousehold ? '-with-household' : '-no-household'}
    </div>
  ),
}))

// Mock Navigation components
vi.mock('./navigation', () => ({
  NavigationLeft: ({ session, hasHousehold }: { session: unknown; hasHousehold: boolean }) => (
    <nav data-testid="navigation-left">
      {session && hasHousehold ? 'authenticated-nav-left' : 'hidden-nav-left'}
    </nav>
  ),
  NavigationRight: ({ session, hasHousehold }: { session: unknown; hasHousehold: boolean }) => (
    <nav data-testid="navigation-right">
      {session && hasHousehold ? 'authenticated-nav-right' : 'hidden-nav-right'}
    </nav>
  ),
}))

// Mock MobileNav component
vi.mock('./mobile-nav', () => ({
  MobileNav: ({ session, hasHousehold }: { session: unknown; hasHousehold: boolean }) => (
    <div data-testid="mobile-nav">
      {session ? 'authenticated-mobile' : 'unauthenticated-mobile'}
      {hasHousehold ? '-with-household' : '-no-household'}
    </div>
  ),
}))

describe('Header component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the app name heading', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Header()
    render(component)

    expect(screen.getByRole('heading', { name: 'Honkadori' })).toBeInTheDocument()
  })

  it('renders heading as link to homepage', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Header()
    render(component)

    const link = screen.getByRole('link', { name: 'Honkadori' })
    expect(link).toHaveAttribute('href', '/')
  })

  it('fetches session and passes to HeaderActions when not authenticated', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Header()
    render(component)

    expect(auth.api.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    })
    expect(screen.getByTestId('header-actions')).toHaveTextContent('unauthenticated')
  })

  it('fetches session and passes to HeaderActions when authenticated with household', async () => {
    const { auth } = await import('@/lib/auth')
    const { hasHouseholdMembership } = await import('@/lib/household')
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
    vi.mocked(hasHouseholdMembership).mockResolvedValue(true)

    const component = await Header()
    render(component)

    expect(auth.api.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    })
    expect(screen.getByTestId('header-actions')).toHaveTextContent('authenticated-with-household')
    expect(screen.getByTestId('navigation-left')).toHaveTextContent('authenticated-nav-left')
    expect(screen.getByTestId('navigation-right')).toHaveTextContent('authenticated-nav-right')
  })

  it('hides navigation when authenticated without household (onboarding)', async () => {
    const { auth } = await import('@/lib/auth')
    const { hasHouseholdMembership } = await import('@/lib/household')
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
    vi.mocked(hasHouseholdMembership).mockResolvedValue(false)

    const component = await Header()
    render(component)

    expect(screen.getByTestId('header-actions')).toHaveTextContent('authenticated-no-household')
    expect(screen.getByTestId('navigation-left')).toHaveTextContent('hidden-nav-left')
    expect(screen.getByTestId('navigation-right')).toHaveTextContent('hidden-nav-right')
  })

  it('renders header with correct styling classes', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Header()
    render(component)

    const header = screen.getByRole('banner')
    expect(header).toHaveClass('fixed', 'top-0', 'z-50', 'border-b')
  })
})
