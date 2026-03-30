import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BottomTabBar } from './bottom-tab-bar'
import type { Session } from '@/lib/auth'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}))

const mockSession: Session = {
  session: {
    id: 'session-123',
    userId: '123',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    token: 'test-token',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  user: {
    id: '123',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: false,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
}

describe('BottomTabBar', () => {
  it('renders 4 tabs when authenticated with household', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/')

    render(<BottomTabBar session={mockSession} hasHousehold={true} />)

    expect(screen.getByRole('link', { name: /today/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /shopping/i })).toHaveAttribute('href', '/shopping')
    expect(screen.getByRole('link', { name: /recipes/i })).toHaveAttribute('href', '/recipes')
    expect(screen.getByRole('link', { name: /household/i })).toHaveAttribute('href', '/household')
  })

  it('renders nothing when no session', () => {
    const { container } = render(<BottomTabBar session={null} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when session exists but no household', () => {
    const { container } = render(<BottomTabBar session={mockSession} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })

  it('highlights Today tab when on root path', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/')

    render(<BottomTabBar session={mockSession} hasHousehold={true} />)

    const todayLink = screen.getByRole('link', { name: /today/i })
    const shoppingLink = screen.getByRole('link', { name: /shopping/i })

    expect(todayLink).toHaveClass('text-primary')
    expect(shoppingLink).toHaveClass('text-muted-foreground')
  })

  it('highlights Shopping tab when on shopping path', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/shopping')

    render(<BottomTabBar session={mockSession} hasHousehold={true} />)

    const todayLink = screen.getByRole('link', { name: /today/i })
    const shoppingLink = screen.getByRole('link', { name: /shopping/i })

    expect(todayLink).toHaveClass('text-muted-foreground')
    expect(shoppingLink).toHaveClass('text-primary')
  })

  it('highlights tab for nested routes using startsWith', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/recipes/123')

    render(<BottomTabBar session={mockSession} hasHousehold={true} />)

    const recipesLink = screen.getByRole('link', { name: /recipes/i })
    expect(recipesLink).toHaveClass('text-primary')
  })

  it('does not highlight Today tab for non-root paths', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/shopping')

    render(<BottomTabBar session={mockSession} hasHousehold={true} />)

    const todayLink = screen.getByRole('link', { name: /today/i })
    expect(todayLink).toHaveClass('text-muted-foreground')
  })
})
