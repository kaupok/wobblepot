import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { HouseholdTabs } from './HouseholdTabs'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}))

async function renderAt(pathname: string) {
  const { usePathname } = await import('next/navigation')
  vi.mocked(usePathname).mockReturnValue(pathname)
  render(<HouseholdTabs />)
  return within(screen.getByRole('navigation', { name: 'Household sections' }))
}

describe('HouseholdTabs', () => {
  it('links Members, Meal preferences, Ingredients and Settings, in that order', async () => {
    const nav = await renderAt('/household')

    const links = nav.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Members',
      'Meal preferences',
      'Ingredients',
      'Settings',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/household',
      '/household/meal-preferences',
      '/household/ingredients',
      '/household/settings',
    ])
  })

  it.each([
    ['/household', 'Members'],
    ['/household/meal-preferences', 'Meal preferences'],
    ['/household/ingredients', 'Ingredients'],
    ['/household/settings', 'Settings'],
  ])('on %s marks %s as the current page, and only it', async (pathname, current) => {
    const nav = await renderAt(pathname)

    const marked = nav
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(marked.map((link) => link.textContent)).toEqual([current])
  })

  it('gives each tab the 44px touch floor', async () => {
    const nav = await renderAt('/household')

    for (const link of nav.getAllByRole('link')) {
      expect(link).toHaveClass('min-h-touch')
    }
  })
})
