import type { MealComponent, PlanEntrySide } from './types'
import type { RestoredSide } from './use-clear-entry'

/** No sides: one array, so a memo over the sides keeps its identity. */
export const NO_SIDES: PlanEntrySide[] = []

/**
 * The sides Cooked on their main charges (HON-1610): planned ones not charged
 * before. A skipped side was not made.
 */
export function sidesToCharge(sides: readonly PlanEntrySide[] = []): PlanEntrySide[] {
  return sides.filter((side) => side.status === 'planned' && !side.pantryDeducted)
}

/**
 * What Cooked on a main charges (HON-1610): the main's components at its cook
 * servings, unless the main was charged before (HON-651), and those of every
 * side in `sidesToCharge`, each scaled to its own servings. The list is for
 * one serving, so the deduction dialog reads it at `servings` 1 and sums an
 * ingredient two dishes use.
 */
export function slotComponents(
  components: readonly MealComponent[],
  servings: number,
  sides: readonly PlanEntrySide[] = [],
  mainCharged = false,
): MealComponent[] {
  const scale = (list: readonly MealComponent[], by: number) =>
    list.map((c) => ({ ...c, quantityPerServing: c.quantityPerServing * by }))
  return [
    ...(mainCharged ? [] : scale(components, servings)),
    ...sidesToCharge(sides).flatMap((side) => scale(side.components, side.cookServings)),
  ]
}

/**
 * The sides as Clear removes them, for Undo to post back with the main.
 * Undefined with no sides, so the restore body leaves the key out.
 */
export function clearedSides(sides: readonly PlanEntrySide[] = []): RestoredSide[] | undefined {
  if (sides.length === 0) return undefined
  return sides.flatMap((side) =>
    side.mealId
      ? [
          {
            mealId: side.mealId,
            servingOverride: side.servingOverride,
            status: side.status === 'skipped' ? ('skipped' as const) : ('planned' as const),
            rating: side.rating,
            pantryDeducted: side.pantryDeducted,
          },
        ]
      : [],
  )
}
