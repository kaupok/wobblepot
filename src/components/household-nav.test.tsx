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
    expect(screen.getByRole('link', { name: 'My preferences' })).toBeInTheDocument()
  })

  it('Household tab links to /household/household', () => {
    render(<HouseholdNav />)

    const householdLink = screen.getByRole('link', { name: 'Household' })
    expect(householdLink).toHaveAttribute('href', '/household/household')
  })

  it('My preferences tab links to /household/profile', () => {
    render(<HouseholdNav />)

    const preferencesLink = screen.getByRole('link', { name: 'My preferences' })
    expect(preferencesLink).toHaveAttribute('href', '/household/profile')
  })

  it('applies active styling to Household tab when on household page', () => {
    mockPathname.mockReturnValue('/household/household')
    render(<HouseholdNav />)

    const householdLink = screen.getByRole('link', { name: 'Household' })
    const preferencesLink = screen.getByRole('link', { name: 'My preferences' })

    expect(householdLink).toHaveClass('text-primary')
    expect(preferencesLink).toHaveClass('text-muted-foreground')
  })

  it('applies active styling to My preferences tab when on profile page', () => {
    mockPathname.mockReturnValue('/household/profile')
    render(<HouseholdNav />)

    const householdLink = screen.getByRole('link', { name: 'Household' })
    const preferencesLink = screen.getByRole('link', { name: 'My preferences' })

    expect(householdLink).toHaveClass('text-muted-foreground')
    expect(preferencesLink).toHaveClass('text-primary')
  })
})
