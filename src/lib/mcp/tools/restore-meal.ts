import 'server-only'

import { z } from 'zod'

import { restoreHouseholdMeal } from '@/lib/deleted-household-meals'
import { HouseholdMealError } from '@/lib/household-meal-error'
import { getHouseholdMeal } from '@/lib/household-meals-read'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

export const restoreMeal = defineTool({
  name: 'restore_meal',
  title: 'Restore a deleted recipe',
  description:
    'Brings back a recipe of the household deleted in the last 30 days, by the id delete_meal gave, with its ingredients and image. Use it when the user deleted the wrong recipe or changes their mind. A recipe that is not deleted answers unchanged.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    mealId: z.string().min(1).max(100).describe('The id delete_meal gave.'),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['restored', 'unchanged'])
      .describe('restored: the recipe is back. unchanged: the recipe was not deleted.'),
    meal: z.object({ id: z.string(), name: z.string() }),
  }),
  run: async (household, { mealId }) => {
    try {
      const meal = await restoreHouseholdMeal(household.id, mealId)
      return { outcome: 'restored' as const, meal }
    } catch (error) {
      if (!(error instanceof HouseholdMealError)) throw error
      if (error.reason === 'mealNotDeleted') {
        const meal = await getHouseholdMeal(household.id, mealId, resolveHouseholdLocale(household))
        return { outcome: 'unchanged' as const, meal: { id: meal.id, name: meal.name } }
      }
      throw new ToolInputError(
        'No recipe of this household deleted in the last 30 days with this id. A recipe deleted longer ago cannot be restored. Nothing was changed.',
      )
    }
  },
})
