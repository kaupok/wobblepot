'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface RouteTab {
  key: string
  href: string
  label: string
}

interface RouteTabsProps {
  tabs: readonly RouteTab[]
  /** The `<nav>`'s accessible name, such as "Account sections". */
  label: string
}

/** The edge fade's width, `w-8`: the reveal keeps the current tab clear of it. */
const FADE_WIDTH = 32

/**
 * Scroll `row` sideways just far enough that `tab` is wholly inside it and
 * clear of the edge fades, as `scrollIntoView({ inline: 'nearest' })` would,
 * but on the row alone: `scrollIntoView` also scrolls the page, which pulls a
 * reader who has already scrolled down back up to the tabs. At either end of
 * the row the browser clamps `scrollLeft`, and that end has no fade.
 */
function revealInRow(row: HTMLElement, tab: HTMLElement) {
  const rowBox = row.getBoundingClientRect()
  const tabBox = tab.getBoundingClientRect()
  const left = rowBox.left + FADE_WIDTH
  const right = rowBox.right - FADE_WIDTH
  // Rounded outward: layout widths are fractional, `scrollLeft` is whole.
  if (tabBox.left < left) row.scrollLeft -= Math.ceil(left - tabBox.left)
  else if (tabBox.right > right) row.scrollLeft += Math.ceil(tabBox.right - right)
}

/** Which ends of `row` have tabs past them. 1px of slack for fractional widths. */
function overflowOf(row: HTMLElement) {
  return {
    start: row.scrollLeft > 1,
    end: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
  }
}

/**
 * A row of tabs, each a route (HON-1229, shared in HON-1256). The current tab
 * is marked by `aria-current`, its colour and a 2px underline, so colour is
 * not the only cue. Each tab clears the 44px touch floor and keeps its
 * natural width.
 *
 * When the row does not fit (four Estonian labels at 360px), it scrolls
 * sideways and the page does not. The 1px rule sits on the list, not the
 * scroll box, so it runs under every tab while the row scrolls. On each
 * route, the current tab scrolls into view, so a deep link to the last tab
 * shows that tab.
 *
 * The scrollbar is hidden, so a fade at each edge with tabs past it says the
 * row scrolls (HON-1468): with the last tab wholly past the edge, the row
 * looked complete. The fade stops above the underline and lets taps through.
 */
export function RouteTabs({ tabs, label }: RouteTabsProps) {
  const pathname = usePathname()
  const rowRef = useRef<HTMLElement>(null)
  const currentRef = useRef<HTMLAnchorElement>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const update = () => {
      const next = overflowOf(row)
      setOverflow((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
    }
    update()
    row.addEventListener('scroll', update, { passive: true })
    // A rotation, a resize or the web font swapping in changes what fits.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(row)
    if (row.firstElementChild) observer?.observe(row.firstElementChild)
    return () => {
      row.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    const reveal = () => {
      if (rowRef.current && currentRef.current) revealInRow(rowRef.current, currentRef.current)
    }
    reveal()
    // The web font swaps in after the first paint and widens the labels,
    // which can push the tab back out. Reveal it again once fonts settle.
    let live = true
    void document.fonts?.ready.then(() => live && reveal())
    return () => {
      live = false
    }
  }, [pathname])

  return (
    <div className="relative">
      <nav ref={rowRef} aria-label={label} className="scrollbar-none overflow-x-auto">
        <ul className="flex w-max min-w-full border-b">
          {tabs.map(({ key, href, label: tabLabel }) => {
            // Exact match: a parent route such as `/account` is a prefix of the
            // other tabs.
            const isCurrent = pathname === href
            return (
              // `-mb-px`: the tab's underline covers the list's rule.
              <li key={key} className="-mb-px">
                <Link
                  ref={isCurrent ? currentRef : undefined}
                  href={href}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={cn(
                    'min-h-touch flex items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150',
                    isCurrent
                      ? 'border-primary text-foreground'
                      : 'text-muted-foreground hover:text-primary border-transparent',
                  )}
                >
                  {tabLabel}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      {(['start', 'end'] as const).map((edge) => (
        <div
          key={edge}
          aria-hidden
          data-edge={edge}
          data-visible={overflow[edge]}
          className={cn(
            // `bottom-0.5`: the underline and the rule stay solid under the fade.
            'from-background pointer-events-none absolute top-0 bottom-0.5 w-8 to-transparent transition-opacity duration-150 motion-reduce:transition-none',
            edge === 'start' ? 'left-0 bg-linear-to-r' : 'right-0 bg-linear-to-l',
            overflow[edge] ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}
    </div>
  )
}
