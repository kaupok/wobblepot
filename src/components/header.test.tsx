import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Header } from './header'
import enMessages from '../../messages/en.json'

// Resolve `getTranslations('nav')` against the real en catalog so the RSC
// Server Component renders the expected chrome strings without pulling in the
// full next-intl request pipeline.
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

// Mock the cached session module
vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
  getHasHousehold: vi.fn(),
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
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    const component = await Header()
    render(component)

    expect(screen.getByRole('heading', { name: 'Honkadori' })).toBeInTheDocument()
  })

  it('renders heading as link to homepage', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    const component = await Header()
    render(component)

    const link = screen.getByRole('link', { name: 'Honkadori' })
    expect(link).toHaveAttribute('href', '/')
  })

  it('fetches session and passes to HeaderActions when not authenticated', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    const component = await Header()
    render(component)

    expect(getSession).toHaveBeenCalled()
    expect(screen.getByTestId('header-actions')).toHaveTextContent('unauthenticated')
  })

  it('fetches session and passes to HeaderActions when authenticated with household', async () => {
    const { getSession, getHasHousehold } = await import('@/lib/session')
    const now = new Date()
    vi.mocked(getSession).mockResolvedValue({
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
    vi.mocked(getHasHousehold).mockResolvedValue(true)

    const component = await Header()
    render(component)

    expect(getSession).toHaveBeenCalled()
    expect(screen.getByTestId('header-actions')).toHaveTextContent('authenticated-with-household')
    expect(screen.getByTestId('navigation-left')).toHaveTextContent('authenticated-nav-left')
    expect(screen.getByTestId('navigation-right')).toHaveTextContent('authenticated-nav-right')
  })

  it('hides navigation when authenticated without household (onboarding)', async () => {
    const { getSession, getHasHousehold } = await import('@/lib/session')
    const now = new Date()
    vi.mocked(getSession).mockResolvedValue({
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
    vi.mocked(getHasHousehold).mockResolvedValue(false)

    const component = await Header()
    render(component)

    expect(screen.getByTestId('header-actions')).toHaveTextContent('authenticated-no-household')
    expect(screen.getByTestId('navigation-left')).toHaveTextContent('hidden-nav-left')
    expect(screen.getByTestId('navigation-right')).toHaveTextContent('hidden-nav-right')
  })

  it('renders header with correct styling classes', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    const component = await Header()
    render(component)

    const header = screen.getByRole('banner')
    expect(header).toHaveClass('fixed', 'top-0', 'z-50', 'border-b')
  })
})
