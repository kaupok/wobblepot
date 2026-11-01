'use client'

import { useMutation } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { PantrySwitch } from '@/components/inventory/PantrySwitch'
import { Body, Heading } from '@/components/ui/typography'
import { apiFetch } from '@/lib/api'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

export interface AtHomeItem {
  ingredientId: string
  name: string
  /** The part of the need the pantry covers, formatted as the To buy rows are. */
  displayQuantity: string
  neededByDate: string
  urgency: UrgencyBucket
  /**
   * The pantry rows that keep the need at home, its own row first: for a herb,
   * also each other form that covers it. The switch acts on all of them.
   */
  pantryRows: PantryRow[]
  isStaple: boolean
}

interface PantryRow {
  id: string
  quantity: number | null
}

/** A switch press: the need, and the rows its request writes. */
interface SwitchChange {
  ingredientId: string
  rows: PantryRow[]
}

interface AtHomeListProps {
  items: AtHomeItem[]
}

// The two days the panel covers, in the order they are listed.
const URGENT_DAYS = ['today', 'tomorrow'] as const

// Switch requests run in order, as on the pantry page, so a quick off and on
// cannot land the wrong way round.
const QUANTITY_SCOPE = { id: 'pantry-quantity' }

/**
 * Today's "At home" tab (HON-1578): the needs for today and tomorrow that the
 * pantry covers, each with the pantry page's switch. Switching a row off sets
 * its pantry rows to 0, so after the refresh the item is on the To buy tab and
 * the meal card stops saying everything is at home.
 *
 * A switched-off row leaves the server's list, but it stays here with its
 * switch off, so a slip is undone with the same switch, and focus stays on it.
 * The tabs unmount this list on a tab change, which drops the kept rows, as a
 * reload does (the `use-kept-ticked-rows` mechanism, for this list's rows).
 */
export function AtHomeList({ items }: AtHomeListProps) {
  const tToday = useTranslations('today')
  const tUrgency = useTranslations('dates.urgency')
  const tPantry = useTranslations('pantry')
  const locale = useLocale()
  const labelId = useId()
  const router = useRouter()

  // Ingredient id → its pantry rows as they were before the switch went off,
  // which switch-on sends back, so a counted row keeps its count rather than
  // dropping to "have some". A row in this map shows its switch off.
  const [switchedOff, setSwitchedOff] = useState(() => new Map<string, PantryRow[]>())

  // The rows on screen: the server's, plus each switched-off row it has
  // dropped since. Updated during render when the prop changes, with no effect.
  const [shown, setShown] = useState(items)
  const [seenItems, setSeenItems] = useState(items)
  if (items !== seenItems) {
    const listed = new Set(items.map((item) => item.ingredientId))
    const kept = shown.filter(
      (item) => !listed.has(item.ingredientId) && switchedOff.has(item.ingredientId),
    )
    setSeenItems(items)
    setShown([...items, ...kept])
  }

  const setOff = (ingredientId: string, before: PantryRow[]) =>
    setSwitchedOff((prev) => new Map(prev).set(ingredientId, before))
  const setOn = (ingredientId: string) =>
    setSwitchedOff((prev) => {
      const next = new Map(prev)
      next.delete(ingredientId)
      return next
    })

  // One request per row: a herb stays at home while any form of it is left.
  const patchQuantities = (rows: PantryRow[]) =>
    Promise.all(
      rows.map(({ id, quantity }) =>
        apiFetch(
          `/api/pantry/${id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quantity }),
          },
          tPantry('errors.updateFailed'),
        ),
      ),
    )

  // The pantry page's switch-off: the row goes to 0, ran out. The switch
  // flips on the press, not in `onMutate`, which waits for an earlier request
  // in the scope.
  const ranOutMutation = useMutation({
    scope: QUANTITY_SCOPE,
    mutationFn: ({ rows }: SwitchChange) =>
      patchQuantities(rows.map(({ id }) => ({ id, quantity: 0 }))),
    onSuccess: () => router.refresh(),
    onError: (_error, { ingredientId }) => {
      setOn(ingredientId)
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  // The pantry page's switch-on: the quantity the row had, or "have some".
  const haveItMutation = useMutation({
    scope: QUANTITY_SCOPE,
    mutationFn: ({ rows }: SwitchChange) => patchQuantities(rows),
    onSuccess: () => router.refresh(),
    onError: (_error, { ingredientId, rows }) => {
      setOff(ingredientId, rows)
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  const handleRanOut = (item: AtHomeItem) => {
    setOff(item.ingredientId, item.pantryRows)
    ranOutMutation.mutate({ ingredientId: item.ingredientId, rows: item.pantryRows })
  }
  const handleHaveIt = (item: AtHomeItem) => {
    setOn(item.ingredientId)
    haveItMutation.mutate({
      ingredientId: item.ingredientId,
      rows: switchedOff.get(item.ingredientId) ?? item.pantryRows,
    })
  }

  // Today first, then by name in the app locale, as on the To buy tab: a bare
  // `localeCompare` differs between server and browser (HON-751).
  const groups = useMemo(() => {
    const sorted = [...shown].sort((a, b) => a.name.localeCompare(b.name, locale))
    return URGENT_DAYS.map((urgency) => ({
      urgency,
      items: sorted.filter((item) => item.urgency === urgency),
    })).filter((group) => group.items.length > 0)
  }, [shown, locale])

  if (groups.length === 0) {
    return (
      <div className="py-6 text-center">
        <Body variant="muted">{tToday('atHomeEmpty')}</Body>
      </div>
    )
  }

  return (
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
                <span className="flex min-w-0 items-center gap-1.5">
                  {/* The pantry page's staple star, so the row reads as a staple. */}
                  {item.isStaple && (
                    <Star
                      role="img"
                      aria-label={tToday('staple')}
                      className="fill-warning text-warning size-3.5 shrink-0"
                    />
                  )}
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {item.displayQuantity && (
                    <span className="text-muted-foreground">{item.displayQuantity}</span>
                  )}
                  <span className="flex items-center gap-1">
                    <PantrySwitch
                      pantryItemId={item.pantryRows[0]?.id ?? item.ingredientId}
                      name={item.name}
                      checked={!switchedOff.has(item.ingredientId)}
                      onRanOut={() => handleRanOut(item)}
                      onHaveIt={() => handleHaveIt(item)}
                    />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
