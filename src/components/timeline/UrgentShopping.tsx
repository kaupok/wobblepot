'use client'

import { useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

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
  /**
   * The phone form above the timeline (HON-766): the title row, the summary
   * and the link, without the item list. Renders nothing when there is nothing
   * to buy for today or tomorrow.
   */
  compact?: boolean
}

// The two days the panel covers, in the order they are listed.
const URGENT_DAYS = ['today', 'tomorrow'] as const

export function UrgentShopping({ items, compact = false }: UrgentShoppingProps) {
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

  if (unpurchasedItems.length === 0) {
    if (compact) return null
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tToday('shoppingTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="bg-success-muted flex h-10 w-10 items-center justify-center rounded-full">
              <Check className="text-success h-5 w-5" />
            </span>
            <Body variant="muted">{tToday('allSet')}</Body>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/shopping">{tToday('viewFullList')}</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  const viewFullList = (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/shopping">{tToday('viewFullList')}</Link>
    </Button>
  )

  // The phone form is one tight block, so its link sits on the title row
  // (DESIGN.md → "Actions sit on the title row") rather than in a footer. It
  // has no item list, so the "Need 2 for today, 1 for tomorrow" line is the
  // whole message; the full panel says the same through its day groups.
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
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{tToday('shoppingTitle')}</CardTitle>
            {viewFullList}
          </div>
        </CardHeader>
        <CardContent>
          <Body variant="muted">{summary}</Body>
        </CardContent>
      </Card>
    )
  }

  // One group per day, labelled by a Caption ("Today", "Tomorrow"), so the day
  // is said once above its items rather than repeated as a tag on every row.
  // The label is not a heading: the card's title is a div, and the meal days
  // beside it are `h5`, so an `h3` here would outrank them in the outline
  // under no heading of its own. The list is named by the label instead.
  const groups = URGENT_DAYS.map((urgency) => ({
    urgency,
    items: unpurchasedItems.filter((item) => item.urgency === urgency),
  })).filter((group) => group.items.length > 0)

  return (
    // The note surface (globals.css → `[data-surface='note']`): the list is
    // the note on the fridge door, a pale yellow sheet rather than a card.
    <Card data-surface="note">
      <CardHeader>
        <CardTitle>{tToday('shoppingTitle')}</CardTitle>
      </CardHeader>
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
        </div>
      </CardContent>
      <CardFooter>{viewFullList}</CardFooter>
    </Card>
  )
}
