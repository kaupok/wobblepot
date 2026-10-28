'use client'

import { useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { useMutation, useMutationState } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { apiFetch } from '@/lib/api'

const PURCHASE_TOGGLE_KEY = ['shopping-list', 'purchase-toggle'] as const

interface PurchaseToggleVariables {
  ingredientId: string
  purchased: boolean
  /** On an untick, the quantity the tick replaced, so the pantry row keeps it. */
  restoreQuantity?: number
}

/** What `/api/shopping-list/purchase` and `/unpurchase` answer with. */
interface PurchaseToggleResponse {
  success?: boolean
  results?: Array<{ pantryItem?: PantryItemData; replacedQuantity?: number | null }>
}

interface UsePurchaseToggleOptions {
  groups: Array<{ items: ShoppingItemData[] }>
  windowDays: number
  setPurchasedIds: Dispatch<SetStateAction<Set<string>>>
  onItemPurchased?: (item: PantryItemData) => void
  /** `restoredQuantity` is set when the pantry row stays at the amount it had before the tick. */
  onItemUnpurchased?: (ingredientId: string, restoredQuantity?: number) => void
}

/**
 * Ticks and unticks a computed shopping-list item: the tick puts the
 * ingredient in the pantry, the untick takes it back out. The checkbox updates
 * first and rolls back when the request fails.
 */
export function usePurchaseToggle({
  groups,
  windowDays,
  setPurchasedIds,
  onItemPurchased,
  onItemUnpurchased,
}: UsePurchaseToggleOptions) {
  const tErrors = useTranslations('shopping.errors')

  const setPurchased = (ingredientId: string, purchased: boolean) =>
    setPurchasedIds((prev) => {
      const next = new Set(prev)
      if (purchased) {
        next.add(ingredientId)
      } else {
        next.delete(ingredientId)
      }
      return next
    })

  // The pantry quantity each tick in this session replaced, by ingredient id,
  // sent back on the untick so it does not delete the amount the household
  // entered (HON-1438). A row ticked before the page loaded has no entry, so
  // its untick removes the row as before.
  const replacedQuantities = useRef(new Map<string, number>())

  const purchaseToggleMutation = useMutation({
    mutationKey: PURCHASE_TOGGLE_KEY,
    mutationFn: ({ ingredientId, purchased, restoreQuantity }: PurchaseToggleVariables) => {
      const endpoint = purchased ? 'purchase' : 'unpurchase'
      return apiFetch<PurchaseToggleResponse>(
        `/api/shopping-list/${endpoint}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredientId, restoreQuantity }),
        },
        tErrors('updateFailed'),
      )
    },
    onMutate: ({ ingredientId, purchased }) => setPurchased(ingredientId, purchased),
    onSuccess: (data, { ingredientId, purchased, restoreQuantity }) => {
      if (purchased) {
        const replacedQuantity = data.results?.[0]?.replacedQuantity
        if (replacedQuantity) replacedQuantities.current.set(ingredientId, replacedQuantity)
      } else if (data.success) {
        replacedQuantities.current.delete(ingredientId)
      }

      // Notify parent about pantry changes (for real-time update)
      if (purchased && onItemPurchased && data.results?.[0]?.pantryItem) {
        // Find the shopping item to get its quantity info
        const shoppingItem = groups
          .flatMap((g) => g.items)
          .find((item) => item.ingredientId === ingredientId)

        // Enhance pantry item with needed quantity data from shopping list
        const enhancedPantryItem = {
          ...data.results[0].pantryItem,
          ...(shoppingItem && {
            neededQuantity: 1, // Actual value doesn't matter for display, just needs to be > 0
            neededDisplayQuantity:
              shoppingItem.pantryDisplayQuantity ?? shoppingItem.displayQuantity,
            windowDays,
            isVague: shoppingItem.isVague,
          }),
        }
        onItemPurchased(enhancedPantryItem)
      } else if (!purchased && onItemUnpurchased && data.success) {
        onItemUnpurchased(ingredientId, restoreQuantity)
      }
    },
    onError: (_error, { ingredientId, purchased }) => {
      setPurchased(ingredientId, !purchased)
      toast.error(tErrors('updateFailed'))
    },
  })

  // Several rows can be in flight at once, so the pending set is derived from
  // the mutation cache rather than the single-observer `isPending`.
  const pendingIdList = useMutationState({
    filters: { mutationKey: PURCHASE_TOGGLE_KEY, status: 'pending' },
    select: (mutation) => (mutation.state.variables as PurchaseToggleVariables).ingredientId,
  })
  const pendingIds = useMemo(() => new Set(pendingIdList), [pendingIdList])

  const handleToggle = (ingredientId: string, purchased: boolean) => {
    if (pendingIds.has(ingredientId)) return
    purchaseToggleMutation.mutate({
      ingredientId,
      purchased,
      ...(!purchased && { restoreQuantity: replacedQuantities.current.get(ingredientId) }),
    })
  }

  return { pendingIds, handleToggle }
}
