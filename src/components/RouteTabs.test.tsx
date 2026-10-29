import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

/** The nav's width; each tab is 100px, so three tabs are 300px of row. */
let navWidth = 200
const scrollLefts = new WeakMap<Element, number>()

/**
 * Lay the row out as jsdom cannot: the nav is `navWidth` wide from x=0, and
 * each tab 100px wide, side by side, shifted by the row's `scrollLeft`, which
 * the browser clamps to the scroll range.
 */
beforeEach(() => {
  navWidth = 200
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const nav = this.closest('nav')!
    if (this === nav) return DOMRect.fromRect({ x: 0, width: navWidth, height: 44 })
    const index = Array.from(nav.querySelectorAll('a')).indexOf(this as HTMLAnchorElement)
    return DOMRect.fromRect({ x: index * 100 - nav.scrollLeft, width: 100, height: 44 })
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'NAV' ? navWidth : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'NAV' ? Math.max(navWidth, TABS.length * 100) : 0
  })
  Object.defineProperty(Element.prototype, 'scrollLeft', {
    configurable: true,
    get(this: HTMLElement) {
      return scrollLefts.get(this) ?? 0
    },
    set(this: HTMLElement, value: number) {
      const max = Math.max(0, this.scrollWidth - this.clientWidth)
      scrollLefts.set(this, Math.min(Math.max(0, value), max))
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function fade(edge: 'start' | 'end') {
  return document.querySelector(`[data-edge="${edge}"]`)!
}

function scrollRowTo(scrollLeft: number) {
  const row = screen.getByRole('navigation')
  act(() => {
    row.scrollLeft = scrollLeft
    fireEvent.scroll(row)
  })
}

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

    // Three ends at 300px; the row shows 0-200px, so it scrolls to its end.
    expect(screen.getByRole('navigation').scrollLeft).toBe(100)
  })

  it('leaves the row where it is when the current tab is already clear of the fades', async () => {
    navWidth = 250
    await renderAt('/things/two')

    // Two ends at 200px, clear of the end fade at 218-250px.
    expect(screen.getByRole('navigation').scrollLeft).toBe(0)
  })

  // A current tab under the end fade would look cut off.
  it('scrolls a current tab out from under the end fade', async () => {
    await renderAt('/things/two')

    // Two ends at 200px; the fade starts at 168px.
    expect(screen.getByRole('navigation').scrollLeft).toBe(32)
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

  describe('edge fades', () => {
    it('shows neither fade when the row fits, as on a wide screen', async () => {
      navWidth = 400
      await renderAt('/things')

      expect(fade('start')).toHaveAttribute('data-visible', 'false')
      expect(fade('end')).toHaveAttribute('data-visible', 'false')
      expect(fade('end')).toHaveClass('opacity-0')
    })

    it('fades the end edge when tabs are past it', async () => {
      await renderAt('/things')

      expect(fade('start')).toHaveAttribute('data-visible', 'false')
      expect(fade('end')).toHaveAttribute('data-visible', 'true')
      expect(fade('end')).toHaveClass('opacity-100')
    })

    it('fades both edges in the middle of the row', async () => {
      await renderAt('/things')
      scrollRowTo(50)

      expect(fade('start')).toHaveAttribute('data-visible', 'true')
      expect(fade('end')).toHaveAttribute('data-visible', 'true')
    })

    it('drops the end fade at the end of the row', async () => {
      await renderAt('/things')
      scrollRowTo(100)

      expect(fade('start')).toHaveAttribute('data-visible', 'true')
      expect(fade('end')).toHaveAttribute('data-visible', 'false')
    })

    it('stays out of reach and above the underline', async () => {
      await renderAt('/things')

      for (const edge of ['start', 'end'] as const) {
        expect(fade(edge)).toHaveAttribute('aria-hidden', 'true')
        expect(fade(edge)).toHaveClass('pointer-events-none', 'bottom-0.5')
      }
    })
  })
})
