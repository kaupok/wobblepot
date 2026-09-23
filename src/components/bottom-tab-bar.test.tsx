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
  it('renders Today, Shopping, Pantry, Recipes in that order', async () => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue('/')

    render(<BottomTabBar session={mockSession} hasHousehold={true} />)

    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Today',
      'Shopping',
      'Pantry',
      'Recipes',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/shopping',
      '/pantry',
      '/recipes',
    ])
    // Household lives in the account sheet (HON-775), not the tab bar.
    expect(screen.queryByRole('link', { name: /household/i })).not.toBeInTheDocument()
  })

  it.each([
    ['/pantry', 'Pantry'],
    ['/shopping', 'Shopping'],
  ])('on %s lights only the %s tab', async (pathname, expected) => {
    const { usePathname } = await import('next/navigation')
    vi.mocked(usePathname).mockReturnValue(pathname)

    render(<BottomTabBar session={mockSession} hasHousehold={true} />)

    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName(expected)
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
    expect(shoppingLink).toHaveAttribute('aria-current', 'page')
    expect(todayLink).not.toHaveAttribute('aria-current')
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
