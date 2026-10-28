import type { ShoppingEmptyStateVariant } from '@/components/inventory/ShoppingEmptyState'

export interface ShoppingEmptyStateInput {
  hasAnyPlan: boolean
  groupCount: number
  totalItems: number
  customItemCount: number
}

/**
 * Picks why the `/shopping` list is empty, or `undefined` when it has items.
 * The sheet and its Add field render either way; the variant only picks the
 * muted line under the Add field (HON-1354).
 *
 * `no-plan` keys on `hasAnyPlan`, never on `generatedAt`: the latter is null
 * whenever the rolling window holds no planned entries, so branching on it told
 * a household whose entries fall past the window that it had no plan, when a
 * wider window would show its list. Such a household falls through to
 * `nothing-needed`, which names the window.
 *
 * Custom items suppress both, since they are a list on their own.
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
