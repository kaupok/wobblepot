import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Home from './page' // import the component directly

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

describe('Home page component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the heading when not authenticated', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Home()
    render(component)
    expect(screen.getByRole('heading', { name: 'TestApp' })).toBeInTheDocument()
  })

  it('renders sign-in and sign-up buttons when not authenticated', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const component = await Home()
    render(component)
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign Up' })).toBeInTheDocument()
  })

  it('renders welcome message when authenticated', async () => {
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

    const component = await Home()
    render(component)
    expect(screen.getByText(/Welcome back, Test User!/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Profile' })).toBeInTheDocument()
  })
})
