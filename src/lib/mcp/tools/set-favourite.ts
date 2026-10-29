import 'server-only'

import { z } from 'zod'

import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import {
  addFavorite,
  FavoriteError,
  findVisibleMealName,
  removeFavorite,
} from '@/lib/meals/favorite'

const NOT_FOUND = 'No meal with this id. Use list_meals to find it. Nothing was changed.'

export const setFavourite = defineTool({
  name: 'set_favourite',
  title: 'Set favourite',
  description:
    "Adds a meal to the household's favourites or removes it, as the heart button in the app does. Favourites rank higher in swap suggestions, and list_meals with source favourites lists them, for example to plan from the household's rotation with plan_meal. A meal that already has the asked-for state is left as it is, with outcome unchanged.",
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    mealId: z.string().min(1).describe('The meal id, from list_meals, get_meal or get_meal_plan.'),
    favourite: z.boolean().describe('true adds the meal to the favourites, false removes it.'),
  }),
  outputSchema: z.object({
    outcome: z.enum(['added', 'removed', 'unchanged']),
    meal: z.object({ id: z.string(), name: z.string() }),
    isFavorite: z.boolean(),
  }),
  run: async (household, { mealId, favourite }) => {
    // Read the meal first: `removeFavorite` does not check it, so an unknown id
    // or another household's recipe would otherwise read as unchanged.
    const meal = await findVisibleMealName(household.id, mealId, resolveHouseholdLocale(household))
    if (!meal) throw new ToolInputError(NOT_FOUND)

    try {
      if (favourite) await addFavorite(household.id, mealId)
      else await removeFavorite(household.id, mealId)
    } catch (error) {
      if (!(error instanceof FavoriteError)) throw error
      // The meal was deleted between the read and the write.
      if (error.reason === 'mealNotFound') throw new ToolInputError(NOT_FOUND)
      // alreadyFavorite or notFavorite: the household has the asked-for state.
      return { outcome: 'unchanged' as const, meal, isFavorite: favourite }
    }
    return {
      outcome: favourite ? ('added' as const) : ('removed' as const),
      meal,
      isFavorite: favourite,
    }
  },
})
