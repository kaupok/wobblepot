/**
 * How many servings a planned meal-plan entry is cooked for.
 *
 * A per-entry `servingOverride` wins; otherwise the meal is cooked for the
 * whole household. This is the single rule shared by every site that scales
 * `MealComponent.quantityPerServing` into a real quantity:
 *
 * - `src/app/api/pantry/route.ts` (needed quantities)
 * - `src/lib/meal-planning/shopping-list.ts` (both aggregations)
 * - `src/app/api/meal-plans/[id]/entries/[entryId]/route.ts` (pantry deduction)
 * - `…/entries/[entryId]/preparation-tips/route.ts` (the AI prompt's servings
 *   and ingredient amounts)
 *
 * It lives here because the pantry route used to omit the override, so the
 * needed quantity and the shopping quantity for the same ingredient in the
 * same week could disagree on screen (HON-614).
 *
 * `servingOverride` is validated `int().min(1).max(20)` on write, so 0 is
 * unreachable and `??` is the correct null-check.
 */
export function getEffectiveServings(
  entry: { servingOverride: number | null },
  householdSize: number,
): number {
  return entry.servingOverride ?? householdSize
}
