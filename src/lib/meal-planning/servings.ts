/**
 * The portion size a new member starts with, by the portion type the
 * household form offers: a child eats half an adult's serving. The household
 * API writes these (`src/app/api/households/route.ts`), and the public sample
 * weeks scale their quantities with them (`src/lib/meal-plans/sample-weeks.ts`).
 */
export const PORTION_BY_TYPE = { adult: 1, child: 0.5 } as const

/**
 * The range a household can set servings to by hand: the serving control's
 * bounds, and the bounds the routes that take a serving count check against.
 */
export const MIN_SERVINGS = 1
export const MAX_SERVINGS = 20

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
 * - `src/lib/meal-plans/entries.ts` (pantry deduction)
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

/**
 * The fields `getCookServings` reads, for a Prisma `select` or `include`. The
 * leftover items it counts are those on an entry that is not skipped. Every
 * site spreads this, so all of them add the same lunches.
 */
export const cookServingsSelect = {
  servingOverride: true,
  status: true,
  cookedServings: true,
  leftoverItems: {
    where: { entry: { status: { not: 'skipped' } } },
    select: { servings: true },
  },
} as const

/**
 * How many servings a recipe entry is cooked, bought and charged for: its own
 * servings (`getEffectiveServings`) plus the servings of every leftover item
 * that points at it, such as tomorrow's lunch from tonight's dinner (HON-1394).
 * A dinner for 3 with a lunch of 2.5 cooks 5.5.
 *
 * A completed entry returns the total it was completed at, so a lunch changed
 * afterwards does not move what the pantry was charged for. An entry completed
 * before that column existed has no total and keeps its own servings: a
 * leftover of a cooked meal adds nothing.
 *
 * The sites that show or edit the entry's own servings (the servings control,
 * `set_meal_servings`, the `servings` output) keep `getEffectiveServings`,
 * because a "+" on a total of 5.5 must not set the override to 6.5.
 */
export function getCookServings(
  entry: {
    servingOverride: number | null
    status: string
    cookedServings: number | null
    leftoverItems: readonly { servings: number | null }[]
  },
  householdServings: number,
): number {
  const own = getEffectiveServings(entry, householdServings)
  if (entry.status === 'completed') return entry.cookedServings ?? own
  return entry.leftoverItems.reduce((total, item) => total + (item.servings ?? 0), own)
}

/**
 * `getCookServings` for an entry as an update saves it: an override in the
 * update wins, and a swap's reset to null counts (`swapEntryData`), because
 * the pantry deduction and the stored count scale by what the request
 * persists, not by the row it read.
 */
export function getSavedCookServings(
  entry: Parameters<typeof getCookServings>[0],
  update: { servingOverride?: number | null },
  householdServings: number,
): number {
  return getCookServings(
    'servingOverride' in update
      ? { ...entry, servingOverride: update.servingOverride ?? null }
      : entry,
    householdServings,
  )
}
