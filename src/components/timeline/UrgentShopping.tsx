'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronUp, ShoppingCart } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
}

export function UrgentShopping({ items }: UrgentShoppingProps) {
  const tToday = useTranslations('today')
  const locale = useLocale()
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

  const todayCount = unpurchasedItems.filter((item) => item.urgency === 'today').length
  const tomorrowCount = unpurchasedItems.filter((item) => item.urgency === 'tomorrow').length

  if (unpurchasedItems.length === 0) {
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

  const summaryParts: string[] = []
  if (todayCount > 0) {
    summaryParts.push(tToday('summaryToday', { count: todayCount }))
  }
  if (tomorrowCount > 0) {
    summaryParts.push(tToday('summaryTomorrow', { count: tomorrowCount }))
  }
  const summary = tToday('summaryNeed', { parts: summaryParts.join(', ') })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{tToday('shoppingTitle')}</CardTitle>
          <span className="text-warning flex items-center gap-1.5">
            <ShoppingCart className="h-4 w-4" />
            <span className="text-sm font-medium">{unpurchasedItems.length}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <Body variant="muted">{summary}</Body>
          <ul className="grid-cols-shopping-row grid gap-2">
            {unpurchasedItems.map((item) => (
              <li
                key={item.ingredientId}
                className="col-span-3 grid grid-cols-subgrid items-center text-sm"
              >
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="text-muted-foreground justify-self-end whitespace-nowrap">
                  {item.displayQuantity}
                </span>
                <span
                  className={cn(
                    'justify-self-end text-xs whitespace-nowrap',
                    item.urgency === 'today' ? 'text-warning font-medium' : 'text-muted-foreground',
                  )}
                >
                  {item.neededByRelative}
                </span>
              </li>
            ))}
          </ul>
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
      <CardFooter>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/shopping">{tToday('viewFullList')}</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
