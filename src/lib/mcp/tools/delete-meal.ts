import 'server-only'

import { z } from 'zod'

import { RECIPE_RESTORE_WINDOW_DAYS } from '@/lib/deleted-household-meals'
import { deleteHouseholdMeal, HouseholdMealError } from '@/lib/household-meals'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { getTodayInTimezone } from '@/lib/meal-planning/dates'

const DAY_MS = 24 * 60 * 60 * 1000

export const deleteMeal = defineTool({
  name: 'delete_meal',
  title: 'Delete a recipe',
  description:
    'Deletes one of the household’s own recipes, the ones list_meals and get_meal report with isOwnRecipe true. Before you call it, confirm with the user, naming the recipe. The household can restore it on the Recipes page for 30 days, or you can call restore_meal with the same id. Meals already planned or cooked with it stay on the plan. A shared recipe cannot be deleted.',
  annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true, idempotentHint: false },
  inputSchema: z.object({
    mealId: z.string().min(1).max(100).describe('The id from list_meals or get_meal.'),
  }),
  outputSchema: z.object({
    outcome: z.literal('deleted'),
    meal: z.object({ id: z.string(), name: z.string() }),
    restorableUntil: z
      .string()
      .describe('The last day, YYYY-MM-DD, on which restore_meal or the app can bring it back.'),
  }),
  run: async (household, { mealId }) => {
    try {
      const { id, name, deletedAt } = await deleteHouseholdMeal(household.id, mealId)
      const until = new Date(deletedAt.getTime() + RECIPE_RESTORE_WINDOW_DAYS * DAY_MS)
      return {
        outcome: 'deleted' as const,
        meal: { id, name },
        restorableUntil: getTodayInTimezone(household.timezone, until),
      }
    } catch (error) {
      if (error instanceof HouseholdMealError) {
        throw new ToolInputError(
          'No recipe of this household with this id. Use list_meals with source own to find it. Nothing was changed.',
        )
      }
      throw error
    }
  },
})
