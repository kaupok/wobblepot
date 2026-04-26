import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NavigationLeft, NavigationRight } from './navigation'

describe('NavigationLeft', () => {
  it('renders nav links when authenticated and has household', () => {
    render(<NavigationLeft isAuthenticated={true} hasHousehold={true} />)

    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pantry & shopping' })).toBeInTheDocument()
  })

  it('renders nothing when not authenticated', () => {
    const { container } = render(<NavigationLeft isAuthenticated={false} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when authenticated but no household', () => {
    const { container } = render(<NavigationLeft isAuthenticated={true} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })
})

describe('NavigationRight', () => {
  it('renders nav links when authenticated and has household', () => {
    render(<NavigationRight isAuthenticated={true} hasHousehold={true} />)

    expect(screen.getByRole('link', { name: 'My recipes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Household' })).toBeInTheDocument()
  })

  it('renders nothing when not authenticated', () => {
    const { container } = render(<NavigationRight isAuthenticated={false} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when authenticated but no household', () => {
    const { container } = render(<NavigationRight isAuthenticated={true} hasHousehold={false} />)

    expect(container.innerHTML).toBe('')
  })
})
