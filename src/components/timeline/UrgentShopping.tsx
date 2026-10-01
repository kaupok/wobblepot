'use client'

import { useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { parseLocalDate, type UrgencyBucket } from '@/lib/meal-planning/dates'

interface ShoppingItem {
  ingredientId: string
  name: string
  displayQuantity: string
  neededByDate: string
  neededByRelative: string
  purchased: boolean
  urgency: UrgencyBucket
}

interface UrgentShoppingProps {
  items: ShoppingItem[]
  /** The household's today, `YYYY-MM-DD`: the day the later-items row counts from. */
  todayDate: string
  /**
   * Unchecked custom items. They have no date, so they are not in `items` and
   * not in the counts, but they are on the list: the panel still links to it.
   */
  openCustomItemCount?: number
  /**
   * The phone form above the timeline (HON-766): the title row, the summary
   * and the link, without the item list. Renders nothing when there is nothing
   * to buy for today or tomorrow.
   */
  compact?: boolean
}

// The two days the panel covers, in the order they are listed.
const URGENT_DAYS = ['today', 'tomorrow'] as const

// The shopping list Today loads (`src/app/page.tsx`, `days: 7`).
const WINDOW_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * What lies past the panel's cut, for the row that closes it (HON-928):
 * `count` is the unpurchased items due after tomorrow, and `days` runs from
 * the household's today through the latest day any unpurchased item is
 * needed, inclusive, capped at the 7-day window. Counted from `todayDate`
 * rather than `new Date()`, which is the server's or browser's day (HON-762).
 */
export function getLaterItemsSummary(
  items: Pick<ShoppingItem, 'neededByDate' | 'purchased' | 'urgency'>[],
  todayDate: string,
): { count: number; days: number } {
  const unpurchased = items.filter((item) => !item.purchased)
  const count = unpurchased.filter(
    (item) => item.urgency !== 'today' && item.urgency !== 'tomorrow',
  ).length
  // ISO dates compare as strings. Starting from today keeps `days` at least 1
  // when every item is overdue.
  const latest = unpurchased.reduce(
    (max, item) => (item.neededByDate > max ? item.neededByDate : max),
    todayDate,
  )
  // `round`, not `floor`: a DST change makes one day 23 or 25 hours long.
  const span =
    Math.round(
      (parseLocalDate(latest).getTime() - parseLocalDate(todayDate).getTime()) / MS_PER_DAY,
    ) + 1
  return { count, days: Math.min(span, WINDOW_DAYS) }
}

export function UrgentShopping({
  items,
  todayDate,
  openCustomItemCount = 0,
  compact = false,
}: UrgentShoppingProps) {
  const tToday = useTranslations('today')
  const tUrgency = useTranslations('dates.urgency')
  const locale = useLocale()
  const labelId = useId()
  const [isPurchasedExpanded, setIsPurchasedExpanded] = useState(false)

  // Filter to only today and tomorrow items, sorted by urgency (today first)
  const urgentItems = useMemo(() => {
    return items
      .filter((item) => item.urgency === 'today' || item.urgency === 'tomorrow')
      .sort((a, b) => {
        // Today items come first
        if (a.urgency === 'today' && b.urgency !== 'today') return -1
        if (a.urgency !== 'today' && b.urgency === 'today') return 1
        // Within same urgency, sort by name. Collate in the app locale: a bare
        // `localeCompare` resolves the runtime's default locale, which is
        // `en-US` on the server and the browser's language on the client —
        // Estonian sorts `z` before `t`, so the two lists came out in different
        // orders and hydration failed with React error 418 (HON-751).
        return a.name.localeCompare(b.name, locale)
      })
  }, [items, locale])

  const unpurchasedItems = urgentItems.filter((item) => !item.purchased)
  const purchasedItems = urgentItems.filter((item) => item.purchased)

  // The full panel's title row is just its name: the link to the list is the
  // list's own last line, which says what is past the cut (DESIGN.md →
  // "Actions sit on the title row", and its continuation-row exception,
  // HON-928). The phone form has no list to end with a row, so its link stays
  // on the title row.
  const titleRow = compact ? (
    <div className="flex items-center justify-between gap-2">
      <CardTitle>{tToday('shoppingTitle')}</CardTitle>
      <Button variant="ghost" size="sm" asChild>
        <Link href="/shopping">{tToday('viewFullList')}</Link>
      </Button>
    </div>
  ) : (
    <CardTitle>{tToday('shoppingTitle')}</CardTitle>
  )

  // "Plus 8 more for the next 5 days" under the listed items, "8 items to buy
  // over the next 5 days" under the empty line, and "View full list" when
  // nothing is due past tomorrow: the full list is the only place to check
  // items off, so the panel links there while anything is on it, custom items
  // included.
  const later = getLaterItemsSummary(items, todayDate)
  const hasUrgent = unpurchasedItems.length > 0
  const continuationLabel =
    later.count > 0
      ? tToday(hasUrgent ? 'moreForDays' : 'toBuyForDays', later)
      : hasUrgent || openCustomItemCount > 0
        ? tToday('viewFullList')
        : null
  const continuationRow = continuationLabel && (
    <div className="border-t pt-3">
      {/* `-mx-2` lines the label up with the list text while the hover box
          keeps its padding. */}
      <div className="-mx-2">
        <Button variant="quiet" size="row" asChild>
          <Link href="/shopping">
            {continuationLabel}
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  )

  if (!hasUrgent) {
    if (compact) return null
    return (
      <Card>
        <CardHeader>{titleRow}</CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* A statement of fact, with no icon: it is reached as often by an
                empty plan as by a stocked pantry, so it claims nothing about
                being ready (DESIGN.md → empty states, HON-923). */}
            <div className="py-6 text-center">
              <Body variant="muted">{tToday('listEmpty')}</Body>
            </div>
            {continuationRow}
          </div>
        </CardContent>
      </Card>
    )
  }

  // The phone form has no item list, so the "Need 2 for today, 1 for
  // tomorrow" line is the whole message; the full panel says the same through
  // its day groups.
  if (compact) {
    const todayCount = unpurchasedItems.filter((item) => item.urgency === 'today').length
    const tomorrowCount = unpurchasedItems.filter((item) => item.urgency === 'tomorrow').length
    const summaryParts: string[] = []
    if (todayCount > 0) {
      summaryParts.push(tToday('summaryToday', { count: todayCount }))
    }
    if (tomorrowCount > 0) {
      summaryParts.push(tToday('summaryTomorrow', { count: tomorrowCount }))
    }
    const summary = tToday('summaryNeed', { parts: summaryParts.join(', ') })

    return (
      <Card size="sm" data-surface="note">
        <CardHeader>{titleRow}</CardHeader>
        <CardContent>
          <Body variant="muted">{summary}</Body>
        </CardContent>
      </Card>
    )
  }

  // One group per day, labelled by a Caption ("Today", "Tomorrow"), so the day
  // is said once above its items rather than repeated as a tag on every row.
  // The label is not a heading: the card's title is a div, so a heading here
  // would have no heading of its own above it, and would read in the outline as
  // part of the meal day (`h2`) beside it. The list is named by the label
  // instead.
  const groups = URGENT_DAYS.map((urgency) => ({
    urgency,
    items: unpurchasedItems.filter((item) => item.urgency === urgency),
  })).filter((group) => group.items.length > 0)

  return (
    // The note surface (globals.css → `[data-surface='note']`): the list is
    // the note on the fridge door, a pale yellow sheet rather than a card.
    <Card data-surface="note">
      <CardHeader>{titleRow}</CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.urgency} className="flex flex-col gap-2">
              <Heading variant="caption" as="p" id={`${labelId}-${group.urgency}`}>
                {tUrgency(group.urgency)}
              </Heading>
              <ul aria-labelledby={`${labelId}-${group.urgency}`} className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <li
                    key={item.ingredientId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{item.name}</span>
                    <span className="text-muted-foreground shrink-0">{item.displayQuantity}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {purchasedItems.length > 0 && (
            <div className="border-t pt-3">
              <button
                onClick={() => setIsPurchasedExpanded(!isPurchasedExpanded)}
                className="flex w-full items-center justify-between text-xs"
              >
                <span className="text-muted-foreground flex items-center gap-1">
                  <Check className="size-3.5" />
                  {tToday('purchasedCollapse', { count: purchasedItems.length })}
                </span>
                {isPurchasedExpanded ? (
                  <ChevronUp className="text-muted-foreground size-3.5" />
                ) : (
                  <ChevronDown className="text-muted-foreground size-3.5" />
                )}
              </button>
              {isPurchasedExpanded && (
                <ul className="mt-2 flex flex-col gap-1">
                  {purchasedItems.map((item) => (
                    <li
                      key={item.ingredientId}
                      className="text-muted-foreground flex items-center justify-between gap-2 text-sm line-through"
                    >
                      <span className="min-w-0 truncate">{item.name}</span>
                      <span className="shrink-0">{item.displayQuantity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {continuationRow}
        </div>
      </CardContent>
    </Card>
  )
}
