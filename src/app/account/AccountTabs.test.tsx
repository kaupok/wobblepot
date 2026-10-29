import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AccountTabs } from './AccountTabs'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}))

async function renderAt(pathname: string) {
  const { usePathname } = await import('next/navigation')
  vi.mocked(usePathname).mockReturnValue(pathname)
  render(<AccountTabs />)
  return within(screen.getByRole('navigation', { name: 'Account sections' }))
}

describe('AccountTabs', () => {
  it('links Profile, Reminders, Connections and Your data, in that order', async () => {
    const nav = await renderAt('/account')

    const links = nav.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Profile',
      'Reminders',
      'Connections',
      'Your data',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/account',
      '/account/reminders',
      '/account/connections',
      '/account/data',
    ])
  })

  it.each([
    ['/account', 'Profile'],
    ['/account/reminders', 'Reminders'],
    ['/account/connections', 'Connections'],
    ['/account/data', 'Your data'],
  ])('on %s marks %s as the current page, and only it', async (pathname, current) => {
    const nav = await renderAt(pathname)

    const marked = nav
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(marked.map((link) => link.textContent)).toEqual([current])
  })

  it('marks no tab on a path outside the four', async () => {
    const nav = await renderAt('/account/other')

    for (const link of nav.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current')
    }
  })

  it('gives each tab the 44px touch floor', async () => {
    const nav = await renderAt('/account')

    for (const link of nav.getAllByRole('link')) {
      expect(link).toHaveClass('min-h-touch')
    }
  })
})
