import type { ShoppingEmptyStateVariant } from '@/components/inventory/ShoppingEmptyState'

export interface ShoppingEmptyStateInput {
  hasAnyPlan: boolean
  groupCount: number
  totalItems: number
  customItemCount: number
}

/**
 * Picks the `/shopping` empty state, or `undefined` when the list renders.
 *
 * `no-plan` keys on `hasAnyPlan`, never on `generatedAt`: the latter is null
 * whenever the rolling window holds no planned entries, so branching on it told
 * a household whose entries fall past the window that it had no plan — and
 * `no-plan` has no window picker to widen with. Such a household falls through
 * to `nothing-needed`, which does.
 *
 * Custom items suppress both empty states, since they are a list on their own.
 */
export function getShoppingEmptyStateVariant({
  hasAnyPlan,
  groupCount,
  totalItems,
  customItemCount,
}: ShoppingEmptyStateInput): ShoppingEmptyStateVariant | undefined {
  if (customItemCount > 0) return undefined
  if (!hasAnyPlan) return 'no-plan'
  if (groupCount === 0 || totalItems === 0) return 'nothing-needed'
  return undefined
}
