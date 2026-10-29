'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

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

/**
 * Scroll `row` sideways just far enough that `tab` is wholly inside it, as
 * `scrollIntoView({ inline: 'nearest' })` would, but on the row alone:
 * `scrollIntoView` also scrolls the page, which pulls a reader who has
 * already scrolled down back up to the tabs.
 */
function revealInRow(row: HTMLElement, tab: HTMLElement) {
  const rowBox = row.getBoundingClientRect()
  const tabBox = tab.getBoundingClientRect()
  // Rounded outward: layout widths are fractional, `scrollLeft` is whole.
  if (tabBox.left < rowBox.left) row.scrollLeft -= Math.ceil(rowBox.left - tabBox.left)
  else if (tabBox.right > rowBox.right) row.scrollLeft += Math.ceil(tabBox.right - rowBox.right)
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
 */
export function RouteTabs({ tabs, label }: RouteTabsProps) {
  const pathname = usePathname()
  const rowRef = useRef<HTMLElement>(null)
  const currentRef = useRef<HTMLAnchorElement>(null)

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
  )
}
