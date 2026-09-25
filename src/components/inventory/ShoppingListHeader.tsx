'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Heading, Body } from '@/components/ui/typography'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSetWindowDays } from './use-shopping-window'

interface ShoppingListHeaderProps {
  /** The window the server rendered with, from `?days=`. */
  windowDays: number
  /** The fact beside the title — the populated list's item count and purchased tail. */
  summary?: ReactNode
  /** Extra controls for the populated list (sort, copy, clear checked). */
  children?: ReactNode
}

/**
 * The header both `/shopping` branches share: the column title with its
 * summary on the same baseline, then one row of controls — the 7/14-day
 * window picker first, followed by whatever the branch owns. The picker is
 * here, rather than in one branch, because the window is only worth changing
 * from whichever state the user is actually looking at. Before HON-624 it
 * lived only in the `nothing-needed` empty state, so widening to 14 days
 * removed the control that could narrow it back.
 *
 * Sits on the page background, not in a `CardHeader`: the column is a section
 * of a workspace page, and its title divides the page the way "Today" divides
 * the timeline (docs/DESIGN.md → Composition rules, "Titles sit on the page
 * background"). The rows under it are the only bordered things.
 *
 * It owns the picker but not the mount reconcile: that lives in `InventoryPage`,
 * which renders on every `/shopping` visit rather than only the ones that have
 * a header, so a saved window is honoured on `no-plan` and `error` too. See
 * `useWindowReconcile`.
 */
export function ShoppingListHeader({ windowDays, summary, children }: ShoppingListHeaderProps) {
  const tShopping = useTranslations('shopping')
  const setWindowDays = useSetWindowDays()

  return (
    <div className="flex flex-col gap-3">
      {/* The summary sits on the title's baseline: it is a fact about the
          list, not a row of its own (as the count does on /recipes). */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading variant="h4" as="h2">
          {tShopping('title')}
        </Heading>
        {summary && <Body variant="muted">{summary}</Body>}
      </div>
      {/*
        Wraps because every control here is unshrinkable: `Button`'s cva base
        is `shrink-0 whitespace-nowrap` and both selects have a fixed width.
        The picker and the sort fit a 390px column together; Copy list and
        Clear checked take the next line there.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Not gated on mount: `windowDays` is a server prop, so the server and
          the first client render agree, and the picker is in the server HTML
          rather than popping in and re-wrapping the row after hydration (HON-771).
          The label is passed explicitly because Radix only fills `SelectValue`
          from the items on the client, so the server HTML would otherwise
          carry an empty trigger. The option labels name the window in full
          ("Next 7 days") because the picker is the only place the window is
          stated — the summary no longer repeats it.
        */}
        <Select value={String(windowDays)} onValueChange={setWindowDays}>
          <SelectTrigger size="sm" className="w-37.5" aria-label={tShopping('ariaTimeWindow')}>
            <SelectValue>
              {windowDays === 14 ? tShopping('windowNext14') : tShopping('windowNext7')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{tShopping('windowNext7')}</SelectItem>
            <SelectItem value="14">{tShopping('windowNext14')}</SelectItem>
          </SelectContent>
        </Select>
        {children}
      </div>
    </div>
  )
}
