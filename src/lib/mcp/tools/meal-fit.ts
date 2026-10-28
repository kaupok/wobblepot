import 'server-only'
import { isMealAllowedForSlot } from '@/lib/meal-planning/meal-allowed-for-slot'
import { ToolInputError, type McpHousehold } from '@/lib/mcp/context'
import type { SlotMealType } from './plan-slot'

/**
 * Refuses a meal the user chose for a slot unless the household can see it, it
 * suits the meal type, and it fits the household's diet, allergens and avoided
 * ingredients. `plan_meal` and `swap_meal` share it, so both refuse with the
 * same words. A meal planned recently passes: the no-repeat window ranks
 * suggestions and does not block a choice (HON-1306, HON-1392).
 *
 * `verb` is how the refusal names the write: a past day logs a meal the
 * household ate (HON-1382).
 */
export async function assertMealFitsSlot(
  household: McpHousehold,
  mealId: string,
  mealType: SlotMealType,
  verb: 'planned' | 'logged',
) {
  const fit = await isMealAllowedForSlot(household, mealId, mealType)
  if (fit === 'notFound') {
    throw new ToolInputError(
      'No meal with this id. Use list_meals to find the meal. Nothing was changed.',
    )
  }
  if (fit === 'unsuitable') {
    throw new ToolInputError(
      `This meal is not a ${mealType}, so it cannot be ${verb} for ${mealType}. Nothing was changed.`,
    )
  }
  if (fit === 'ruledOut') {
    throw new ToolInputError(
      "This meal does not fit the household's diet, allergens or avoided ingredients. Nothing was changed.",
    )
  }
}
