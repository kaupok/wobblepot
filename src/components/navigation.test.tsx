import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NavigationLeft, NavigationRight } from './navigation'
import type { Session } from '@/lib/auth'

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

describe('NavigationLeft', () => {
  it('renders nav links when session exists and has household', () => {
    render(<NavigationLeft session={mockSession} hasHousehold={true} />)

    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Meal plan' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pantry & shopping' })).toBeInTheDocument()
  })

  it('renders nothing when no session', () => {
    const { container } = render(<NavigationLeft session={null} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when session exists but no household', () => {
    const { container } = render(<NavigationLeft session={mockSession} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })
})

describe('NavigationRight', () => {
  it('renders nav links when session exists and has household', () => {
    render(<NavigationRight session={mockSession} hasHousehold={true} />)

    expect(screen.getByRole('link', { name: 'My recipes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Household' })).toBeInTheDocument()
  })

  it('renders nothing when no session', () => {
    const { container } = render(<NavigationRight session={null} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when session exists but no household', () => {
    const { container } = render(<NavigationRight session={mockSession} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })
})
