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

// Mock Next.js headers
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

// Mock HeaderActions component
vi.mock('./header-actions', () => ({
  HeaderActions: ({ session }: { session: unknown }) => (
    <div data-testid="header-actions">{session ? 'authenticated' : 'unauthenticated'}</div>
  ),
}))

// Mock Navigation components
vi.mock('./navigation', () => ({
  NavigationLeft: ({ session }: { session: unknown }) => (
    <nav data-testid="navigation-left">
      {session ? 'authenticated-nav-left' : 'unauthenticated-nav-left'}
    </nav>
  ),
  NavigationRight: ({ session }: { session: unknown }) => (
    <nav data-testid="navigation-right">
      {session ? 'authenticated-nav-right' : 'unauthenticated-nav-right'}
    </nav>
  ),
}))

// Mock MobileNav component
vi.mock('./mobile-nav', () => ({
  MobileNav: ({ session }: { session: unknown }) => (
    <div data-testid="mobile-nav">
      {session ? 'authenticated-mobile' : 'unauthenticated-mobile'}
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

  it('fetches session and passes to HeaderActions when authenticated', async () => {
    const { auth } = await import('@/lib/auth')
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

    const component = await Header()
    render(component)

    expect(auth.api.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    })
    expect(screen.getByTestId('header-actions')).toHaveTextContent('authenticated')
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
