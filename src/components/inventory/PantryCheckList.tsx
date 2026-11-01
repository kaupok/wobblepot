'use client'

import { useMutation } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/typography'
import { apiFetch } from '@/lib/api'

/** A "have some" need that two or more meals use, as `loadShoppingList` returns it in `check`. */
export interface PantryCheckRow {
  ingredientId: string
  name: string
  /** The window's whole need, formatted as the To buy rows are. */
  displayQuantity: string
  mealCount: number
  /** `YYYY-MM-DD`, the first day a meal needs it. */
  neededByDate: string
  /** `neededByDate` as the household reads it ("tomorrow"), formatted on the server. */
  neededByRelative: string
  /**
   * The pantry rows that keep the need at home, its own row first: for a herb,
   * also each other form that covers it. Add to list writes all of them.
   */
  pantryRows: PantryRow[]
  isStaple: boolean
}

interface PantryRow {
  id: string
  quantity: number | null
}

/** A press: the need, and the rows its request writes. */
interface RowChange {
  ingredientId: string
  rows: PantryRow[]
}

interface PantryCheckListProps {
  items: PantryCheckRow[]
  /**
   * The rows a request wrote, once it lands: `/shopping`'s pantry column
   * holds its own copy of the rows, and the refresh does not reset it.
   */
  onQuantitiesChanged?: (rows: PantryRow[]) => void
}

// Quantity requests run in order, as on the pantry page, so a quick Add and
// Undo cannot land the wrong way round.
const QUANTITY_SCOPE = { id: 'pantry-quantity' }

/**
 * The check above To buy (HON-1585): the "have some" needs that two or more
 * meals use, with the week's amount, so the shopper can say which will not
 * last. Add to list sets the item's pantry rows to 0 (ran out), so after the
 * refresh it is on To buy with the week's amount. A row left alone writes
 * nothing: it counts as enough.
 *
 * An added row leaves the server's list, but it stays here as "Added" with an
 * Undo, until a reload, so a slip is undone in place and focus stays on the
 * row. Shown on every load, with no dismiss. Nothing renders when the check
 * is empty.
 */
export function PantryCheckList({ items, onQuantitiesChanged }: PantryCheckListProps) {
  const t = useTranslations('today.check')
  const tPantry = useTranslations('pantry')
  const locale = useLocale()
  const labelId = useId()
  const router = useRouter()

  // Ingredient id → its pantry rows as they were before Add to list, which
  // Undo sends back. A row in this map shows as added.
  const [added, setAdded] = useState(() => new Map<string, PantryRow[]>())
  // Ingredient ids the shopper pressed Add to list or Undo on, kept until a
  // reload: an Undo pressed before the Add's refresh lands leaves the row out
  // of `added`, and the refresh must not drop it then.
  const [touched, setTouched] = useState(() => new Set<string>())

  // The rows on screen: the server's, plus each touched row it has dropped
  // since. Updated during render when the prop changes, with no effect.
  const [shown, setShown] = useState(items)
  const [seenItems, setSeenItems] = useState(items)
  if (items !== seenItems) {
    const listed = new Set(items.map((item) => item.ingredientId))
    const kept = shown.filter(
      (item) => !listed.has(item.ingredientId) && touched.has(item.ingredientId),
    )
    setSeenItems(items)
    setShown([...items, ...kept])
  }

  const markAdded = (ingredientId: string, before: PantryRow[]) =>
    setAdded((prev) => new Map(prev).set(ingredientId, before))
  const markUndone = (ingredientId: string) =>
    setAdded((prev) => {
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

  // The row changes on the press, not in `onMutate`, which waits for an
  // earlier request in the scope.
  const addMutation = useMutation({
    scope: QUANTITY_SCOPE,
    mutationFn: ({ rows }: RowChange) =>
      patchQuantities(rows.map(({ id }) => ({ id, quantity: 0 }))),
    onSuccess: (_data, { rows }) =>
      onQuantitiesChanged?.(rows.map(({ id }) => ({ id, quantity: 0 }))),
    // On an error too: with two herb rows, one request can land and the
    // other fail, and the screen must show what the pantry now holds.
    onSettled: () => router.refresh(),
    onError: (_error, { ingredientId }) => {
      markUndone(ingredientId)
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  // Undo: each row's quantity before the add, "have some" for a check row.
  const undoMutation = useMutation({
    scope: QUANTITY_SCOPE,
    mutationFn: ({ rows }: RowChange) => patchQuantities(rows),
    onSuccess: (_data, { rows }) => onQuantitiesChanged?.(rows),
    onSettled: () => router.refresh(),
    onError: (_error, { ingredientId, rows }) => {
      markAdded(ingredientId, rows)
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  const handleAdd = (item: PantryCheckRow) => {
    setTouched((prev) => new Set(prev).add(item.ingredientId))
    markAdded(item.ingredientId, item.pantryRows)
    addMutation.mutate({ ingredientId: item.ingredientId, rows: item.pantryRows })
  }
  const handleUndo = (item: PantryCheckRow) => {
    markUndone(item.ingredientId)
    undoMutation.mutate({
      ingredientId: item.ingredientId,
      rows: added.get(item.ingredientId) ?? item.pantryRows,
    })
  }

  // First needed first, then by name in the app locale: a bare
  // `localeCompare` differs between server and browser (HON-751). ISO dates
  // compare as strings.
  const sorted = useMemo(
    () =>
      [...shown].sort((a, b) =>
        a.neededByDate === b.neededByDate
          ? a.name.localeCompare(b.name, locale)
          : a.neededByDate < b.neededByDate
            ? -1
            : 1,
      ),
    [shown, locale],
  )

  if (sorted.length === 0) return null

  // The panel's day-group pattern: a Caption, not a heading, naming the list.
  return (
    <div className="flex flex-col gap-2">
      <Heading variant="caption" as="p" id={labelId}>
        {t('heading')}
      </Heading>
      <ul aria-labelledby={labelId} className="flex flex-col gap-2">
        {sorted.map((item) => (
          <PantryCheckListRow
            key={item.ingredientId}
            item={item}
            isAdded={added.has(item.ingredientId)}
            onAdd={() => handleAdd(item)}
            onUndo={() => handleUndo(item)}
          />
        ))}
      </ul>
    </div>
  )
}

interface PantryCheckListRowProps {
  item: PantryCheckRow
  isAdded: boolean
  onAdd: () => void
  onUndo: () => void
}

function PantryCheckListRow({ item, isAdded, onAdd, onUndo }: PantryCheckListRowProps) {
  const t = useTranslations('today.check')
  const tToday = useTranslations('today')
  const addRef = useRef<HTMLButtonElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const actedRef = useRef(false)

  // Add to list gives way to Undo, and Undo to Add to list, so the pressed
  // control unmounts and focus would fall to the page body (docs/DESIGN.md →
  // Focus management). Exactly one is mounted, so it is the target whichever
  // way the row moved, a revert after a failed request included.
  useEffect(() => {
    if (!actedRef.current) return
    if (document.activeElement && document.activeElement !== document.body) return
    ;(undoRef.current ?? addRef.current)?.focus()
  }, [isAdded])

  const act = (action: () => void) => {
    actedRef.current = true
    action()
  }

  // Separators, not prepositions, so Estonian needs no declension. An added
  // row leads with "Added", so the line says what the Undo beside it undoes.
  const meta = [
    isAdded && t('added'),
    item.displayQuantity,
    t('meals', { count: item.mealCount }),
    item.neededByRelative,
  ]
    .filter(Boolean)
    .join(' · ')

  // Two lines: the name with its one action, as a title row (DESIGN.md →
  // "Actions sit on the title row"), and the meta under both at full width,
  // so the 320px Today panel does not wrap it around the button.
  return (
    <li className="flex flex-col gap-0.5 text-sm">
      <span className="flex items-center justify-between gap-2">
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
        {/* Keyed: the two sit in the same place, and React would otherwise
            reuse one's node for the other, focus and all. */}
        {isAdded ? (
          <Button
            key="undo"
            ref={undoRef}
            variant="quiet"
            size="sm-touch"
            className="shrink-0"
            aria-label={t('undoLabel', { name: item.name })}
            onClick={() => act(onUndo)}
          >
            {t('undo')}
          </Button>
        ) : (
          <Button
            key="add"
            ref={addRef}
            variant="outline"
            size="sm-touch"
            className="shrink-0"
            aria-label={t('addLabel', { name: item.name })}
            onClick={() => act(onAdd)}
          >
            {t('add')}
          </Button>
        )}
      </span>
      <span className="text-muted-foreground">{meta}</span>
    </li>
  )
}
