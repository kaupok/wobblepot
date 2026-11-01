'use client'

import { useMutation, useMutationState } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { InlineAddItem } from '@/components/pantry/InlineAddItem'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { RowGroup } from '@/components/ui/row-group'
import { Body, Heading } from '@/components/ui/typography'
import { ApiError, apiFetch } from '@/lib/api'
import { comparePantryItems } from '@/lib/meal-planning/pantry-order'

import { GroupHeading } from './GroupHeading'
import { PantryItemRow } from './PantryItemRow'

const TOGGLE_STAPLE_KEY = ['pantry', 'toggle-staple'] as const
const HAVE_IT_KEY = ['pantry', 'have-it'] as const
const RAN_OUT_KEY = ['pantry', 'ran-out'] as const
const AMOUNT_KEY = ['pantry', 'amount'] as const
// The switch's two flips and an amount share one queue, so a quick second tap that undoes
// the first lands after it on the server. Each `onMutate` still runs at once;
// only the request waits.
const QUANTITY_SCOPE = { id: 'pantry-quantity' }

const onHandSelector = (id: string) => `[data-on-hand="${id}"]`
const removeSelector = (id: string) => `[data-remove="${id}"]`
const amountSelector = (id: string) => `[data-amount="${id}"]`
// The add search is the section's only input.
const ADD_INPUT_SELECTOR = 'input'

interface ToggleStapleVariables {
  id: string
  currentIsStaple: boolean
  /** The row's quantity at the tap: with an amount, the star decides its list line. */
  quantity: number | null
}

interface SetAmountVariables {
  item: PantryItemData
  quantity: number | null
}

interface PantrySectionProps {
  items: PantryItemData[]
  onItemsChange: Dispatch<SetStateAction<PantryItemData[]>>
  /**
   * The pantry could not be fetched. Renders an error in place of the list, so
   * a failed load is never shown as "Your pantry is empty" — and hides the add
   * search, which would otherwise build a pantry on top of one it cannot see.
   */
  loadFailed?: boolean
  onPantryItemRemoved?: (ingredientId: string) => void
  /** The toast's Undo put a removed row back, so the shopping list reverts. */
  onPantryItemRestored?: (ingredientId: string) => void
  /**
   * A row's quantity changed on the server (the switch, an amount). The
   * shopping list buys a row at 0 and skips one at null, so the parent
   * re-reads it.
   */
  onPantryQuantityChanged?: () => void
}

export function PantrySection({
  items,
  onItemsChange,
  loadFailed = false,
  onPantryItemRemoved,
  onPantryItemRestored,
  onPantryQuantityChanged,
}: PantrySectionProps) {
  const tPantry = useTranslations('pantry')
  const locale = useLocale()

  // A row at 0 has run out (docs/PROJECT_SPEC.md → Pantry Quantity
  // Semantics). A staple stays a staple at 0, because staples are always
  // stocked; only the rest split into On hand and Ran out.
  const staples = items.filter((item) => item.isStaple)
  const onHand = items.filter((item) => !item.isStaple && item.quantity !== 0)
  const ranOut = items.filter((item) => !item.isStaple && item.quantity === 0)

  // The switch, Remove and Undo each unmount or mount the row in focus, so focus
  // would fall to `<body>` (docs/DESIGN.md → Focus management). The mutation
  // names the control to focus once the change has rendered.
  const sectionRef = useRef<HTMLElement>(null)
  const focusAfterRender = useRef<string | null>(null)
  useEffect(() => {
    const selector = focusAfterRender.current
    if (!selector) return
    focusAfterRender.current = null
    sectionRef.current?.querySelector<HTMLElement>(selector)?.focus()
  })

  // The list is the parent's state rather than a query, so the optimistic
  // updates write through `onItemsChange` and roll back the same way.
  const toggleStapleMutation = useMutation({
    mutationKey: TOGGLE_STAPLE_KEY,
    mutationFn: ({ id, currentIsStaple }: ToggleStapleVariables) =>
      apiFetch(
        `/api/pantry/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isStaple: !currentIsStaple }),
        },
        tPantry('errors.updateFailed'),
      ),
    onMutate: ({ id, currentIsStaple }) => {
      onItemsChange((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isStaple: !currentIsStaple } : item)),
      )
    },
    // The list skips a staple unless it ran out (HON-1398), and an ordinary
    // row at 0 or below the need has a line, so the star adds or removes one:
    // re-read the list. A "have some" row (null) has no line either way.
    onSuccess: (_data, { quantity }) => {
      if (quantity !== null) onPantryQuantityChanged?.()
    },
    onError: (_error, { id, currentIsStaple }) => {
      onItemsChange((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isStaple: currentIsStaple } : item)),
      )
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  // Switch-off sets the quantity to 0. An ordinary row moves to Ran out; a
  // staple stays in Staples, because staples are always stocked. Either way
  // the row's switch keeps focus, so a second press undoes a slip. The undo
  // sends back the quantity the row had, so a counted row keeps its count
  // rather than dropping to null, "have some". Kept for this visit only:
  // after a reload switch-on sends null. Switch-on takes its entry out when
  // pressed, not when its request lands, because requests queue behind each
  // other and a newer switch-off may have written the entry since.
  const quantityBeforeRanOut = useRef(new Map<string, number | null>())
  const ranOutMutation = useMutation({
    mutationKey: RAN_OUT_KEY,
    scope: QUANTITY_SCOPE,
    mutationFn: (item: PantryItemData) =>
      apiFetch(
        `/api/pantry/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: 0 }),
        },
        tPantry('errors.updateFailed'),
      ),
    onMutate: ({ id, quantity }) => {
      quantityBeforeRanOut.current.set(id, quantity)
      // An ordinary row moves to Ran out, so focus follows its switch there:
      // a second press undoes a slip.
      focusAfterRender.current = onHandSelector(id)
      onItemsChange((prev) =>
        prev.map((item) => (item.id === id ? { ...item, quantity: 0 } : item)),
      )
    },
    onSuccess: () => onPantryQuantityChanged?.(),
    // A failed switch-off leaves its entry: the row is back above 0, so no
    // switch-on reads it before the next switch-off writes it again.
    onError: (_error, { id, quantity }) => {
      // An ordinary row moves back to On hand and its switch remounts, so follow it.
      const onHand = sectionRef.current?.querySelector(onHandSelector(id))
      if (onHand && onHand === document.activeElement) {
        focusAfterRender.current = onHandSelector(id)
      }
      onItemsChange((prev) => prev.map((item) => (item.id === id ? { ...item, quantity } : item)))
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  // Switch-on sets the quantity to null, "have some", or back to the count
  // switch-off took from the row this visit. A staple stays where it is; an
  // ordinary row moves back to On hand. Either way focus goes to the row's
  // own switch, so a second press undoes a slip (HON-1535).
  const haveItMutation = useMutation({
    mutationKey: HAVE_IT_KEY,
    scope: QUANTITY_SCOPE,
    // The variables are the row as it will be, with the quantity to restore.
    mutationFn: (item: PantryItemData) =>
      apiFetch(
        `/api/pantry/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: item.quantity }),
        },
        tPantry('errors.updateFailed'),
      ),
    onMutate: ({ id, quantity }) => {
      focusAfterRender.current = onHandSelector(id)
      onItemsChange((prev) => prev.map((item) => (item.id === id ? { ...item, quantity } : item)))
    },
    onSuccess: () => onPantryQuantityChanged?.(),
    onError: (_error, { id, quantity }) => {
      // The row goes back to 0, so the next switch-on restores the same count,
      // unless a newer switch-off has written one since.
      if (!quantityBeforeRanOut.current.has(id)) quantityBeforeRanOut.current.set(id, quantity)
      // An ordinary row moves back to Ran out and its switch remounts, so follow it.
      const onHand = sectionRef.current?.querySelector(onHandSelector(id))
      if (onHand && onHand === document.activeElement) {
        focusAfterRender.current = onHandSelector(id)
      }
      onItemsChange((prev) =>
        prev.map((item) => (item.id === id ? { ...item, quantity: 0 } : item)),
      )
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  // An On hand row's amount (HON-1402): `null` is "have some", above 0 an
  // amount the shopping list subtracts. A 0 is ran out: the row moves, so
  // focus goes to its switch, which then restores the amount it had.
  const amountMutation = useMutation({
    mutationKey: AMOUNT_KEY,
    scope: QUANTITY_SCOPE,
    mutationFn: ({ item, quantity }: SetAmountVariables) =>
      apiFetch(
        `/api/pantry/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity }),
        },
        tPantry('errors.updateFailed'),
      ),
    onMutate: ({ item, quantity }) => {
      if (quantity === 0) {
        quantityBeforeRanOut.current.set(item.id, item.quantity)
        focusAfterRender.current = onHandSelector(item.id)
      }
      onItemsChange((prev) => prev.map((row) => (row.id === item.id ? { ...row, quantity } : row)))
    },
    onSuccess: () => onPantryQuantityChanged?.(),
    onError: (_error, { item }) => {
      // A 0 that failed brings the row back to On hand, where its amount
      // button returns, so follow the row to the control the household used.
      const onHand = sectionRef.current?.querySelector(onHandSelector(item.id))
      if (onHand && onHand === document.activeElement) {
        focusAfterRender.current = amountSelector(item.id)
      }
      onItemsChange((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, quantity: item.quantity } : row)),
      )
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  // Undo creates the row again: the route has no restore, so the new row has a
  // new id. The removed item's "needed" fields fill what the response lacks.
  const restoreMutation = useMutation({
    mutationFn: (item: PantryItemData) =>
      apiFetch<PantryItemData>(
        '/api/pantry',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ingredientId: item.ingredient.id,
            quantity: item.quantity,
            isStaple: item.isStaple,
          }),
        },
        tPantry('errors.restoreFailed'),
      ),
    onSuccess: (data, item) => {
      const restored = { ...item, ...data }
      focusAfterRender.current = removeSelector(restored.id)
      onItemsChange((prev) => [...prev, restored].sort(comparePantryItems(locale)))
      onPantryItemRestored?.(item.ingredient.id)
    },
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error(
        '[pantry] restore failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      toast.error(tPantry('errors.restoreFailed'))
    },
  })

  // Remove takes the row out at once, with no confirmation: the toast's Undo
  // puts it back (HON-1355). Focus goes to the next row's Remove in the same
  // group, so a household can clear several in a row.
  const removeMutation = useMutation({
    // The route answers 204 with no body.
    mutationFn: (item: PantryItemData) =>
      apiFetch<void>(`/api/pantry/${item.id}`, { method: 'DELETE' }),
    onMutate: (removed) => {
      const group = removed.isStaple ? staples : removed.quantity === 0 ? ranOut : onHand
      const index = group.findIndex((item) => item.id === removed.id)
      const next = group[index + 1] ?? group[index - 1]
      focusAfterRender.current = next ? removeSelector(next.id) : ADD_INPUT_SELECTOR
      onItemsChange((prev) => prev.filter((item) => item.id !== removed.id))
    },
    // The Undo waits for the DELETE, because a POST before it lands is a 409.
    onSuccess: (_data, removed) => {
      toast(tPantry('success.removed', { name: removed.ingredient.name }), {
        action: {
          label: tPantry('undo'),
          onClick: (event) => {
            // Sonner returns focus to where it was before the toast whenever
            // focus leaves the toaster, which would undo the move to the
            // restored row. Leave now, so that return happens first.
            event.currentTarget.blur()
            restoreMutation.mutate(removed)
          },
        },
        duration: 6000,
      })
      // The shopping list unticks the item
      onPantryItemRemoved?.(removed.ingredient.id)
    },
    onError: (_error, removed) => {
      onItemsChange((prev) => [...prev, removed].sort(comparePantryItems(locale)))
      toast.error(tPantry('errors.removeFailed'))
    },
  })

  // Several rows can be in flight at once, so per-row pending state comes from
  // the mutation cache rather than the single-observer `isPending`.
  const togglingIds = useMutationState({
    filters: { mutationKey: TOGGLE_STAPLE_KEY, status: 'pending' },
    select: (mutation) => (mutation.state.variables as ToggleStapleVariables).id,
  })

  const handleToggleStaple = (id: string, currentIsStaple: boolean) =>
    toggleStapleMutation.mutate({
      id,
      currentIsStaple,
      quantity: items.find((item) => item.id === id)?.quantity ?? null,
    })

  const handleRemove = (item: PantryItemData) => removeMutation.mutate(item)

  const handleHaveIt = (item: PantryItemData) => {
    const quantity = quantityBeforeRanOut.current.get(item.id) ?? null
    quantityBeforeRanOut.current.delete(item.id)
    haveItMutation.mutate({ ...item, quantity })
  }

  const handleRanOut = (item: PantryItemData) => ranOutMutation.mutate(item)

  const handleSetAmount = (item: PantryItemData, quantity: number | null) =>
    amountMutation.mutate({ item, quantity })

  const handleItemAdded = (newItem: PantryItemData) => {
    // Into its sorted place, as a purchase lands, rather than at the end (HON-920)
    onItemsChange((prev) => [...prev, newItem].sort(comparePantryItems(locale)))
  }

  // Create a set of ingredient IDs currently in pantry for the search indicator
  const pantryIngredientIds = new Set(items.map((item) => item.ingredient.id))

  const content = loadFailed ? (
    <div role="alert">
      <Body tone="destructive">{tPantry('loadFailed')}</Body>
    </div>
  ) : items.length === 0 ? (
    <>
      <InlineAddItem onItemAdded={handleItemAdded} pantryIngredientIds={pantryIngredientIds} />
      <Body variant="muted">{tPantry('empty')}</Body>
    </>
  ) : (
    <>
      <InlineAddItem onItemAdded={handleItemAdded} pantryIngredientIds={pantryIngredientIds} />

      {staples.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupHeading label={tPantry('stapleSection')} total={staples.length} />
          <RowGroup>
            {staples.map((item) => (
              <PantryItemRow
                key={item.id}
                item={item}
                onToggleStaple={handleToggleStaple}
                onRemove={handleRemove}
                onRanOut={handleRanOut}
                onHaveIt={handleHaveIt}
                isToggling={togglingIds.includes(item.id)}
              />
            ))}
          </RowGroup>
        </div>
      )}

      {onHand.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupHeading label={tPantry('onHandSection')} total={onHand.length} />
          <RowGroup>
            {onHand.map((item) => (
              <PantryItemRow
                key={item.id}
                item={item}
                onToggleStaple={handleToggleStaple}
                onRemove={handleRemove}
                onRanOut={handleRanOut}
                onHaveIt={handleHaveIt}
                onSetAmount={handleSetAmount}
                isToggling={togglingIds.includes(item.id)}
              />
            ))}
          </RowGroup>
        </div>
      )}

      {ranOut.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupHeading label={tPantry('ranOutSection')} total={ranOut.length} />
          <RowGroup>
            {ranOut.map((item) => (
              <PantryItemRow
                key={item.id}
                item={item}
                onToggleStaple={handleToggleStaple}
                onRemove={handleRemove}
                onRanOut={handleRanOut}
                onHaveIt={handleHaveIt}
                isToggling={togglingIds.includes(item.id)}
              />
            ))}
          </RowGroup>
        </div>
      )}

      <Body variant="muted">{tPantry('footerHint')}</Body>
    </>
  )

  // Title on the page background, each group one bordered `RowGroup` under
  // it — the same shape as the list beside it and the timeline on Today
  // (docs/DESIGN.md → Composition rules, "Headings divide, borders contain").
  // `gap-6` between the header, the search and each group.
  return (
    <section ref={sectionRef} className="flex flex-col gap-6">
      {/* The count sits on the title's baseline, as the shopping list's does
          beside it (HON-957). A failed load has no count to show. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading variant="h4" as="h2">
          {tPantry('title')}
        </Heading>
        {!loadFailed && (
          <Body variant="muted">{tPantry('ingredientCount', { count: items.length })}</Body>
        )}
      </div>
      {content}
    </section>
  )
}
