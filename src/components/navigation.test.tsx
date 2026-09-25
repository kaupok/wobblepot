import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { usePathname } from 'next/navigation'
import { NavigationLeft, NavigationRight } from './navigation'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}))

function renderBoth() {
  return render(
    <>
      <NavigationLeft isAuthenticated={true} hasHousehold={true} />
      <NavigationRight isAuthenticated={true} hasHousehold={true} />
    </>,
  )
}

describe('active page', () => {
  it.each([
    ['/', 'Today'],
    ['/shopping', 'Pantry & shopping'],
    ['/pantry', 'Pantry & shopping'],
    ['/recipes', 'My recipes'],
    ['/recipes/imagine', 'My recipes'],
    ['/household', 'Household'],
  ])('marks exactly one link as current on %s', (pathname, expected) => {
    vi.mocked(usePathname).mockReturnValue(pathname)
    renderBoth()

    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName(expected)
    expect(current[0]).toHaveClass('text-foreground')
    // Colour and `aria-current` only: no underline inside the header pill.
    expect(current[0]).not.toHaveClass('underline')
  })

  it('styles inactive links as muted with no aria-current', () => {
    vi.mocked(usePathname).mockReturnValue('/shopping')
    renderBoth()

    const today = screen.getByRole('link', { name: 'Today' })
    expect(today).not.toHaveAttribute('aria-current')
    expect(today).toHaveClass('text-muted-foreground')
    expect(today).not.toHaveClass('text-foreground')
  })
})

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
