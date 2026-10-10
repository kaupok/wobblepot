/**
 * The portion size a new member starts with, by the portion type the
 * household form offers: a child eats half an adult's serving. The household
 * API writes these (`src/app/api/households/route.ts`), and the public sample
 * weeks scale their quantities with them (`src/lib/meal-plans/sample-weeks.ts`).
 */
export const PORTION_BY_TYPE = { adult: 1, child: 0.5 } as const

/**
 * How many servings a household cooks for when an entry carries no override:
 * the sum of its members' portion sizes, rounded to the nearest 0.5, at least 1.
 *
 * Two adults and a toddler at 0.5× cook for 2.5 servings, not 3. The result can
 * be a fraction, and nothing downstream rounds it to a whole number: rounding
 * 2.5 up to 3 is the bug this replaced, where the member count stood in for the
 * servings and a toddler was counted as an adult (HON-1040).
 *
 * A member without a preferences row counts as 1, the column's default.
 */
export function sumPortions(
  members: readonly { preferences: { portionMultiplier: number } | null }[],
): number {
  const sum = members.reduce(
    (total, member) => total + (member.preferences?.portionMultiplier ?? 1),
    0,
  )
  return Math.max(1, Math.round(sum * 2) / 2)
}

/**
 * How many servings a planned meal-plan entry is cooked for.
 *
 * A per-entry `servingOverride` wins; otherwise the meal is cooked for the
 * whole household. This is the single rule shared by every site that scales
 * `MealComponent.quantityPerServing` into a real quantity:
 *
 * - `src/lib/meal-planning/load-pantry.ts` (needed quantities)
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
 *
 * `householdServings` is `sumPortions` of the household's members, not the
 * member count. It is the default path, which makes every member's portion
 * size an input to the prep-tips cache on almost every entry. Every membership
 * write and every portion change therefore has to clear that cache — see
 * `invalidateFutureEntrySteps` in `./preparation-steps-cache.ts` (HON-684).
 */
export function getEffectiveServings(
  entry: { servingOverride: number | null },
  householdServings: number,
): number {
  return entry.servingOverride ?? householdServings
}
