'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { CardHeader } from '@/components/ui/card'
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
  /** Secondary line under the title — the populated list's window/count/purchased summary. */
  summary?: ReactNode
  /** Extra controls for the populated list (copy, clear checked, sort). */
  children?: ReactNode
}

/**
 * The `CardHeader` both `/shopping` branches share: the page title, an optional
 * summary line, whatever controls the branch owns, and the 7/14-day window
 * picker — which is here, rather than in one branch, because the window is only
 * worth changing from whichever state the user is actually looking at. Before
 * HON-624 the picker lived only in the `nothing-needed` empty state, so
 * widening to 14 days removed the control that could narrow it back.
 *
 * It owns the picker but not the mount reconcile: that lives in `InventoryPage`,
 * which renders on every `/shopping` visit rather than only the ones that have
 * a header, so a saved window is honoured on `no-plan` and `error` too. See
 * `useWindowReconcile`.
 */
export function ShoppingListHeader({ windowDays, summary, children }: ShoppingListHeaderProps) {
  const tShopping = useTranslations('shopping')
  const setWindowDays = useSetWindowDays()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration pattern, same as ShoppingSection's sort select
    setMounted(true)
  }, [])

  return (
    <CardHeader>
      {/*
        A single-line title centres against the picker; a title with a summary
        under it top-aligns against the controls, so the first line of each
        column sits on the same baseline rather than the block centring itself.
      */}
      <div className={`flex justify-between gap-2 ${summary ? 'items-start' : 'items-center'}`}>
        <div className="flex flex-col gap-1">
          <Heading variant="h4" as="h2">
            {tShopping('title')}
          </Heading>
          {summary && <Body variant="muted">{summary}</Body>}
        </div>
        {/*
          Wraps because every control here is unshrinkable: `Button`'s cva base
          is `shrink-0 whitespace-nowrap`, the sort `Select` is `w-[150px]` and
          this one is `w-[100px]`. Copy list + Clear checked + the two selects
          is well past the ~310px the card header has on a 390px viewport,
          which is the primary form factor for /shopping.
        */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {children}
          {mounted && (
            <Select value={String(windowDays)} onValueChange={setWindowDays}>
              <SelectTrigger
                size="sm"
                className="w-[100px]"
                aria-label={tShopping('ariaTimeWindow')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{tShopping('windowOption7')}</SelectItem>
                <SelectItem value="14">{tShopping('windowOption14')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </CardHeader>
  )
}
