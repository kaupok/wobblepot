'use client'

import { useMutation } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { type PantryStock, PantryStockControl } from '@/components/inventory/PantryStockControl'
import { QUANTITY_SCOPE } from '@/components/inventory/use-pantry-low'
import { Heading } from '@/components/ui/typography'
import { apiFetch } from '@/lib/api'

/** A need with no amount that two or more meals use, as `loadShoppingList` returns it in `check`. */
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
   * The need's pantry rows, its own row first: for a herb, also each other
   * form that covers it. The stock control writes all of them.
   */
  pantryRows: PantryRow[]
  isStaple: boolean
  /** What the rows say (HON-1638): ran out when all are at 0, low when any is low. */
  stock: PantryStock
}

export interface PantryRow {
  id: string
  quantity: number | null
  low: boolean
}

/** A press: the need, the part pressed, and the rows its requests write. */
interface StockChange {
  ingredientId: string
  stock: PantryStock
  rows: PantryRow[]
}

interface PantryCheckListProps {
  items: PantryCheckRow[]
  /**
   * The id of a title that names the list. Without one, the list shows its
   * own Caption.
   */
  labelledBy?: string
}

/** Each part's request body, as the pantry row's control sends it. */
const STOCK_BODY: Record<PantryStock, { quantity?: number | null; low?: boolean }> = {
  haveIt: { quantity: null, low: false },
  low: { low: true },
  ranOut: { quantity: 0 },
}

/**
 * The check (HON-1585): the needs with no amount that two or more meals use,
 * with the week's amount, so the shopper can say which will not last. Each
 * row has the pantry row's stock control (HON-1638): Low or Ran out puts the
 * item on the list, and the row stays here with that part pressed. A row left
 * alone writes nothing: it counts as enough.
 *
 * Shown on every load, with no dismiss. Nothing renders when the check is
 * empty.
 */
export function PantryCheckList({ items, labelledBy }: PantryCheckListProps) {
  const t = useTranslations('today.check')
  const tPantry = useTranslations('pantry')
  const locale = useLocale()
  const ownLabelId = useId()
  const labelId = labelledBy ?? ownLabelId
  const router = useRouter()

  // Ingredient id → the part pressed, until the server's `stock` agrees. The
  // part changes on the press, not in `onMutate`, which waits for an earlier
  // request in the scope.
  const [pressed, setPressed] = useState(() => new Map<string, PantryStock>())
  // Updated during render when the prop changes, with no effect: a press the
  // refreshed list now shows needs no override.
  const [seenItems, setSeenItems] = useState(items)
  if (items !== seenItems) {
    setSeenItems(items)
    const serverStock = new Map(items.map((item) => [item.ingredientId, item.stock]))
    const kept = new Map(
      [...pressed].filter(([ingredientId, stock]) => serverStock.get(ingredientId) !== stock),
    )
    if (kept.size !== pressed.size) setPressed(kept)
  }

  // One request per row: a herb stays at home while any form of it is left.
  // Each request is settled before any error is thrown, so a row that failed
  // does not stop the others.
  const mutation = useMutation({
    scope: QUANTITY_SCOPE,
    mutationFn: async ({ stock, rows }: StockChange) => {
      const results = await Promise.allSettled(
        rows.map(({ id }) =>
          apiFetch(
            `/api/pantry/${id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(STOCK_BODY[stock]),
            },
            tPantry('errors.updateFailed'),
          ),
        ),
      )
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
    },
    // On an error too: with two herb rows, one request can land and the
    // other fail, and the screen must show what the pantry now holds.
    onSettled: () => router.refresh(),
    // The part goes back to the server's, unless a later press replaced it.
    onError: (_error, { ingredientId, stock }) => {
      setPressed((prev) => {
        if (prev.get(ingredientId) !== stock) return prev
        const next = new Map(prev)
        next.delete(ingredientId)
        return next
      })
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  // Have it or Low leaves a row at 0 alone while another row keeps the need
  // at home: the household marked that form ran out, and a press here says
  // nothing about it. With every row at 0, all of them are written.
  const handleStockChange = (item: PantryCheckRow, stock: PantryStock) => {
    const allOut = item.pantryRows.every((row) => row.quantity === 0)
    const rows =
      stock === 'ranOut' || allOut
        ? item.pantryRows
        : item.pantryRows.filter((row) => row.quantity !== 0)
    setPressed((prev) => new Map(prev).set(item.ingredientId, stock))
    mutation.mutate({ ingredientId: item.ingredientId, stock, rows })
  }

  // First needed first, then by name in the app locale: a bare
  // `localeCompare` differs between server and browser (HON-751). ISO dates
  // compare as strings.
  const sorted = useMemo(
    () =>
      [...items].sort((a, b) =>
        a.neededByDate === b.neededByDate
          ? a.name.localeCompare(b.name, locale)
          : a.neededByDate < b.neededByDate
            ? -1
            : 1,
      ),
    [items, locale],
  )

  if (sorted.length === 0) return null

  const list = (
    <ul aria-labelledby={labelId} className="flex flex-col gap-4">
      {sorted.map((item) => (
        <PantryCheckListRow
          key={item.ingredientId}
          item={item}
          stock={pressed.get(item.ingredientId) ?? item.stock}
          onStockChange={(stock) => handleStockChange(item, stock)}
        />
      ))}
    </ul>
  )
  if (labelledBy) return list

  // The day-group pattern: a Caption, not a heading, naming the list.
  return (
    <div className="flex flex-col gap-2">
      <Heading variant="caption" as="p" id={labelId}>
        {t('heading')}
      </Heading>
      {list}
    </div>
  )
}

interface PantryCheckListRowProps {
  item: PantryCheckRow
  stock: PantryStock
  onStockChange: (stock: PantryStock) => void
}

function PantryCheckListRow({ item, stock, onStockChange }: PantryCheckListRowProps) {
  const t = useTranslations('today.check')
  const tToday = useTranslations('today')

  // Separators, not prepositions, so Estonian needs no declension.
  const meta = [item.displayQuantity, t('meals', { count: item.mealCount }), item.neededByRelative]
    .filter(Boolean)
    .join(' · ')

  // Three lines: the name, the meta, and the stock control, because the 272px
  // panel content has no room for the control beside the name. The control
  // stays mounted through a press, so focus stays on it.
  return (
    <li className="flex flex-col items-start gap-1 text-sm">
      <span className="flex items-start gap-1.5">
        {/* The pantry page's staple star, so the row reads as a staple. */}
        {item.isStaple && (
          <Star
            role="img"
            aria-label={tToday('staple')}
            className="fill-warning text-warning mt-0.5 size-3.5 shrink-0"
          />
        )}
        <span className="break-words">{item.name}</span>
      </span>
      <span className="text-muted-foreground">{meta}</span>
      <PantryStockControl
        pantryItemId={item.pantryRows[0]?.id ?? item.ingredientId}
        name={item.name}
        stock={stock}
        onStockChange={onStockChange}
      />
    </li>
  )
}
