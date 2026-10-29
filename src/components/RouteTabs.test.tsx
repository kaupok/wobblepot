import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RouteTabs } from './RouteTabs'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}))

const TABS = [
  { key: 'one', href: '/things', label: 'One' },
  { key: 'two', href: '/things/two', label: 'Two' },
  { key: 'three', href: '/things/three', label: 'Three' },
]

/**
 * Lay the row out as jsdom cannot: the nav is 200px wide from x=0, and each
 * tab 100px wide, side by side, shifted by the row's `scrollLeft`.
 */
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const nav = this.closest('nav')!
    if (this === nav) return DOMRect.fromRect({ x: 0, width: 200, height: 44 })
    const index = Array.from(nav.querySelectorAll('a')).indexOf(this as HTMLAnchorElement)
    return DOMRect.fromRect({ x: index * 100 - nav.scrollLeft, width: 100, height: 44 })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function renderAt(pathname: string) {
  const { usePathname } = await import('next/navigation')
  vi.mocked(usePathname).mockReturnValue(pathname)
  const view = render(<RouteTabs tabs={TABS} label="Thing sections" />)
  return { ...view, nav: within(screen.getByRole('navigation', { name: 'Thing sections' })) }
}

describe('RouteTabs', () => {
  it('links each tab with its label, in order', async () => {
    const { nav } = await renderAt('/things')

    const links = nav.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['One', 'Two', 'Three'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/things',
      '/things/two',
      '/things/three',
    ])
  })

  it.each([
    ['/things', 'One'],
    ['/things/two', 'Two'],
    ['/things/three', 'Three'],
  ])('on %s marks %s as the current page, and only it', async (pathname, current) => {
    const { nav } = await renderAt(pathname)

    const marked = nav
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(marked.map((link) => link.textContent)).toEqual([current])
  })

  it('marks no tab on a path outside the list', async () => {
    const { nav } = await renderAt('/things/other')

    for (const link of nav.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current')
    }
    expect(screen.getByRole('navigation').scrollLeft).toBe(0)
  })

  it('gives each tab the 44px touch floor and keeps its label on one line', async () => {
    const { nav } = await renderAt('/things')

    for (const link of nav.getAllByRole('link')) {
      expect(link).toHaveClass('min-h-touch', 'whitespace-nowrap')
    }
  })

  // A deep link to the last tab must show that tab when the row scrolls.
  it('scrolls the row just far enough to show a current tab past its right edge', async () => {
    await renderAt('/things/three')

    // Three ends at 300px; the row shows 0-200px.
    expect(screen.getByRole('navigation').scrollLeft).toBe(100)
  })

  it('leaves the row where it is when the current tab is already in view', async () => {
    await renderAt('/things/two')

    expect(screen.getByRole('navigation').scrollLeft).toBe(0)
  })

  it('scrolls the row back to a current tab before its left edge', async () => {
    const { usePathname } = await import('next/navigation')
    const { rerender } = await renderAt('/things/three')

    vi.mocked(usePathname).mockReturnValue('/things')
    rerender(<RouteTabs tabs={TABS} label="Thing sections" />)

    expect(screen.getByRole('navigation').scrollLeft).toBe(0)
  })

  // `scrollIntoView` would also move the page, back up to the tabs.
  it('scrolls only the row, never the page', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    await renderAt('/things/three')

    expect(scrollIntoView).not.toHaveBeenCalled()
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })
})
