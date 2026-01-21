import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HouseholdNav } from './household-nav'

// Mock next/navigation
const mockPathname = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

describe('HouseholdNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname.mockReturnValue('/household/household')
  })

  it('renders both navigation tabs', () => {
    render(<HouseholdNav />)

    expect(screen.getByRole('link', { name: 'Household' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument()
  })

  it('Household tab links to /household/household', () => {
    render(<HouseholdNav />)

    const householdLink = screen.getByRole('link', { name: 'Household' })
    expect(householdLink).toHaveAttribute('href', '/household/household')
  })

  it('Members tab links to /household/members', () => {
    render(<HouseholdNav />)

    const membersLink = screen.getByRole('link', { name: 'Members' })
    expect(membersLink).toHaveAttribute('href', '/household/members')
  })

  it('applies active styling to Household tab when on household page', () => {
    mockPathname.mockReturnValue('/household/household')
    render(<HouseholdNav />)

    const householdLink = screen.getByRole('link', { name: 'Household' })
    const membersLink = screen.getByRole('link', { name: 'Members' })

    expect(householdLink).toHaveClass('text-primary')
    expect(membersLink).toHaveClass('text-muted-foreground')
  })

  it('applies active styling to Members tab when on members page', () => {
    mockPathname.mockReturnValue('/household/members')
    render(<HouseholdNav />)

    const householdLink = screen.getByRole('link', { name: 'Household' })
    const membersLink = screen.getByRole('link', { name: 'Members' })

    expect(householdLink).toHaveClass('text-muted-foreground')
    expect(membersLink).toHaveClass('text-primary')
  })
})
