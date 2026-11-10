'use client'

import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import { apiFetch } from '@/lib/api'

// The stock control's parts and an amount share one queue, so a quick second
// tap that undoes the first lands after it on the server. Each `onMutate`
// still runs at once; only the request waits.
export const QUANTITY_SCOPE = { id: 'pantry-quantity' }

const LOW_KEY = ['pantry', 'low'] as const

interface SetLowVariables {
  item: PantryItemData
  low: boolean
}

interface FollowRow {
  /** The row moves to another section: focus follows it. */
  onMove: (id: string) => void
  /** A failed move puts the row back: focus follows it if still there. */
  onMoveBack: (id: string) => void
}

/**
 * The stock control's Low part, and Have it from Low (HON-1587, HON-1624):
 * `PATCH { low }`. A low staple, or a low row a planned meal needs, gets a
 * shopping list line (HON-1586, HON-1595), so a change re-reads the list. Low
 * on a row at 0 also sets it to null, "have some", in the same request, as
 * the server does: an ordinary row moves out of Ran out, so `followRow` moves
 * focus with it. Any other change leaves the row in place.
 */
export function usePantryLow(
  onItemsChange: Dispatch<SetStateAction<PantryItemData[]>>,
  onPantryQuantityChanged?: () => void,
  followRow?: FollowRow,
) {
  const tPantry = useTranslations('pantry')

  const lowMutation = useMutation({
    mutationKey: LOW_KEY,
    scope: QUANTITY_SCOPE,
    mutationFn: ({ item, low }: SetLowVariables) =>
      apiFetch<PantryItemData>(
        `/api/pantry/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ low }),
        },
        tPantry('errors.updateFailed'),
      ),
    onMutate: ({ item, low }) => {
      const fromRanOut = low && item.quantity === 0
      if (fromRanOut) followRow?.onMove(item.id)
      onItemsChange((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, low, ...(fromRanOut && { quantity: null }) } : row,
        ),
      )
    },
    onSuccess: () => onPantryQuantityChanged?.(),
    onError: (_error, { item, low }) => {
      // Low from Ran out goes back to Ran out, while the row still holds the
      // "have some" this request wrote. A row with a count took an amount
      // queued behind this request, and that one lands on the server, so the
      // row keeps it and only loses the low. Otherwise ran out replaces low:
      // a row marked ran out since then keeps low false.
      if (low && item.quantity === 0) {
        followRow?.onMoveBack(item.id)
        onItemsChange((prev) =>
          prev.map((row) =>
            row.id === item.id
              ? { ...row, low: false, ...(row.quantity === null && { quantity: 0 }) }
              : row,
          ),
        )
      } else {
        onItemsChange((prev) =>
          prev.map((row) =>
            row.id === item.id && row.quantity !== 0 ? { ...row, low: item.low ?? false } : row,
          ),
        )
      }
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  return (item: PantryItemData, low: boolean) => lowMutation.mutate({ item, low })
}
