import { createHash } from 'node:crypto'
import type { StepsRequestInput } from '@/lib/ai/preparation-steps'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'

/**
 * Bump when the steps prompt changes in a way that should rewrite every
 * stored row. Part of the hash, so the next `pnpm steps:library` run finds
 * every row stale.
 */
export const LIBRARY_STEPS_VERSION = 2 // 2: British English steps (HON-1098)

/**
 * A fingerprint of everything the steps prompt reads for one meal and locale:
 * the (translated) name, servings, time, the (translated) ingredient lines and
 * the locale. A stored row whose `inputHash` matches was written from these
 * same inputs and is fresh; anything else is stale. Keyed on the inputs rather
 * than `Meal.updatedAt`, because the seed bumps `updatedAt` on every deploy
 * without changing the meal, and because a component or translation edit
 * changes the prompt without touching the meal row at all.
 */
export function stepsInputHash(input: StepsRequestInput): string {
  const hash = createHash('sha256')
  hash.update(
    JSON.stringify({
      v: LIBRARY_STEPS_VERSION,
      locale: input.locale,
      name: input.mealName,
      servings: input.servings,
      timeMinutes: input.timeMinutes,
      // Sorted: the components come back from Postgres in no fixed order, and
      // the same set must give the same hash. The unit is the one the prompt
      // shows, so a liquid's row goes stale when it turns to ml (HON-1070),
      // while every other row keeps its hash: for `g` and `piece` without the
      // flag, `displayUnit` is the stored unit.
      components: input.components
        .map((c) => [c.name, c.quantityPerServing, displayUnit(c)] as const)
        .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2].localeCompare(b[2])),
    }),
  )
  return hash.digest('hex')
}
