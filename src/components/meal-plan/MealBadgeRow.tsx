'use client'

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/** The row's `gap-1.5`, in px, for the fit check. */
const GAP_PX = 6

/**
 * A meal card's first badge row, held to one line (HON-1575). Linear's pattern:
 * when the badges do not fit, they overlap, and a badge whose label sits in a
 * `.truncate` span (`MealTypeBadge`, `ProteinBadge`) gives way first, down to
 * an ellipsis. Icon and time badges keep their width. On hover the badge under
 * the pointer takes its full label and the others contract to make room; a
 * phone has no hover, and the full label is in the DOM for a screen reader,
 * so it truncates there with no expand (a tap on the card opens the meal).
 *
 * Badges must be direct children: the row styles them with child selectors.
 * An overlapped badge takes the card's colour behind it and a ring of it, so
 * the badge on top reads as cut out of the one below, and `outline` badges,
 * which have no fill, do not show through.
 */
export function MealBadgeRow({ children, className }: { children: ReactNode; className?: string }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [overlap, setOverlap] = useState(false)

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    // The width each badge would take untruncated: a label badge's padding and
    // border around the label's full width, not its box, which the overlap's
    // floor can stretch or the shrink can cut. Independent of the overlap, so
    // toggling it never feeds back into the check.
    const check = () => {
      const badges = Array.from(row.children) as HTMLElement[]
      const natural = badges.reduce((sum, badge) => {
        const label = badge.querySelector<HTMLElement>('.truncate')
        if (!label) return sum + badge.offsetWidth
        const style = getComputedStyle(badge)
        const edges = [
          'paddingLeft',
          'paddingRight',
          'borderLeftWidth',
          'borderRightWidth',
        ] as const
        return sum + label.scrollWidth + edges.reduce((s, e) => s + Number.parseFloat(style[e]), 0)
      }, 0)
      setOverlap(natural + GAP_PX * Math.max(badges.length - 1, 0) > row.clientWidth)
    }
    check()
    // The labels change width when the web font replaces the fallback, and
    // the row's own width does not, so the observer alone would miss it.
    // `?.` because jsdom has no `document.fonts`.
    let live = true
    void document.fonts?.ready.then(() => live && check())
    const observer = new ResizeObserver(check)
    observer.observe(row)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [children])

  return (
    <div
      ref={rowRef}
      data-overlap={overlap || undefined}
      className={cn(
        'flex min-w-0 items-center gap-1.5',
        // Labels give way, down to "L…", so a recipe for all three meals still
        // fits a 256px row; the rest keep their width. The floor only while
        // overlapping: a roomy row's "Kala" keeps its own width.
        '*:has-[.truncate]:not-hover:shrink data-overlap:*:has-[.truncate]:min-w-9',
        // The badge under the pointer takes its full label, on top.
        '*:relative *:hover:z-10 *:hover:max-w-full',
        // The badge's own transition plus `flex-shrink`, so the swap on hover
        // slides; Tailwind has no token that names it, and one row uses it.
        // eslint-disable-next-line shadcn/no-arbitrary-values
        '*:transition-[flex-shrink,color,background-color,box-shadow] *:duration-200 motion-reduce:*:transition-none',
        // A badge pushed right with `ml-auto` (the time) stays out of the
        // overlap, so it keeps the row's right edge (HON-1352).
        'data-overlap:*:ring-card data-overlap:*:data-[variant=outline]:bg-card data-overlap:*:ring-2 data-overlap:*:not-first:not-[.ml-auto]:-ml-3.5',
        className,
      )}
    >
      {children}
    </div>
  )
}
