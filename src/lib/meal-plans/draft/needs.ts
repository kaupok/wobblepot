import { type DisplayUnit, displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { aggregateComponents } from '@/lib/meal-planning/shopping-list'

import type { DraftContext, DraftView } from './context'
import { draftLeftoverServings, type WeekDay } from './week'

/**
 * One ingredient the draft's recipe meals need, and what the pantry says of
 * it. Not the shopping list: after `apply_plan`, `get_shopping_list` is.
 */
export interface DraftNeed {
  ingredientId: string
  name: string
  /** The total at cook servings, in `unit`. */
  quantity: number
  unit: DisplayUnit
  /** A vague amount ("a pinch"); `phrase` says it and `quantity` is a guess. */
  isVague: boolean
  phrase: string | null
  firstNeededOn: string
  mealCount: number
  pantry: {
    status: 'none' | 'haveIt' | 'low' | 'ranOut'
    /** The pantry's amount in `unit`, when it records one. */
    quantity: number | null
  }
}

/**
 * What the draft adds to buy, at the servings the week shows: its own recipe
 * meals at their cook servings, and a kept planned dinner at the servings a
 * draft lunch now takes from it.
 */
export function buildNeeds(
  ctx: DraftContext,
  view: DraftView,
  week: readonly WeekDay[],
): DraftNeed[] {
  const own = week.flatMap((day) =>
    day.slots.flatMap((slot) => {
      const meal = slot.changed && slot.mealId ? ctx.meals.get(slot.mealId) : undefined
      if (!meal || !slot.cookServings) return []
      return [{ date: parseLocalDate(slot.date), servings: slot.cookServings, meal }]
    }),
  )
  // A kept dinner may be on a day the draft does not name, so not in `week`.
  const kept = [...draftLeftoverServings(ctx, view)].flatMap(([key, servings]) => {
    const entry = view.named.has(key) ? undefined : ctx.mains.get(key)
    const meal =
      entry?.status === 'planned' && entry.mealId ? ctx.meals.get(entry.mealId) : undefined
    if (!entry || !meal || servings === 0) return []
    return [{ date: parseLocalDate(entry.date), servings, meal }]
  })
  const needed = aggregateComponents(
    [...own, ...kept].map(({ date, servings, meal }) => ({
      date,
      servings,
      components: meal.components,
    })),
    ctx.locale,
  )

  return [...needed].map(([ingredientId, need]) => {
    const row = ctx.pantry.get(ingredientId)
    const status = !row ? 'none' : row.quantity === 0 ? 'ranOut' : row.low ? 'low' : 'haveIt'
    return {
      ingredientId,
      name: need.ingredient.name,
      quantity: Math.round(need.quantity * 100) / 100,
      unit: displayUnit(need.ingredient),
      isVague: need.isVague,
      phrase: need.originalPhrase,
      firstNeededOn: toDateString(need.earliestNeededDate),
      mealCount: need.mealCount,
      pantry: { status, quantity: row?.quantity ?? null },
    }
  })
}
