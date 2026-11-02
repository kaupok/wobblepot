'use client'

import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import { apiFetch } from '@/lib/api'

// The switch's two flips, an amount and Running low share one queue, so a
// quick second tap that undoes the first lands after it on the server. Each
// `onMutate` still runs at once; only the request waits.
export const QUANTITY_SCOPE = { id: 'pantry-quantity' }

const LOW_KEY = ['pantry', 'low'] as const

interface SetLowVariables {
  item: PantryItemData
  low: boolean
}

/**
 * The pantry row's Running low toggle (HON-1587): `PATCH { low }`. A low row
 * gets a no-amount shopping list line (HON-1586), so a change re-reads the
 * list. The toggle stays mounted, so focus stays on it.
 */
export function usePantryLow(
  onItemsChange: Dispatch<SetStateAction<PantryItemData[]>>,
  onPantryQuantityChanged?: () => void,
) {
  const tPantry = useTranslations('pantry')
  const setLow = (id: string, low: boolean) =>
    onItemsChange((prev) => prev.map((row) => (row.id === id ? { ...row, low } : row)))

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
    onMutate: ({ item, low }) => setLow(item.id, low),
    onSuccess: () => onPantryQuantityChanged?.(),
    onError: (_error, { item }) => {
      // Ran out replaces low: a row switched off since then keeps low false.
      onItemsChange((prev) =>
        prev.map((row) =>
          row.id === item.id && row.quantity !== 0 ? { ...row, low: item.low ?? false } : row,
        ),
      )
      toast.error(tPantry('errors.updateFailed'))
    },
  })

  return (item: PantryItemData, low: boolean) => lowMutation.mutate({ item, low })
}
