import 'server-only'
import { z } from 'zod'
import { loadMeals, MEALS_DEFAULT_LIMIT, MEALS_MAX_LIMIT } from '@/lib/meals/load-meals'
import { defineTool } from '@/lib/mcp/context'

const mealType = z.enum(['breakfast', 'lunch', 'dinner'])

export const listMeals = defineTool({
  name: 'list_meals',
  title: 'List meals',
  description:
    "Finds meals the household can plan: Wobblepot's shared recipes and the household's own, without those its allergies or excluded ingredients rule out. Use it to search by name or ingredient, or to suggest a meal. Call get_meal with an id for the ingredients.",
  inputSchema: z.object({
    search: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Words in the meal name or an ingredient name. Tolerates typos.'),
    mealType: mealType.optional().describe('Only meals that suit this meal type.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MEALS_MAX_LIMIT)
      .default(MEALS_DEFAULT_LIMIT)
      .describe(`How many meals to return, at most ${MEALS_MAX_LIMIT}.`),
  }),
  outputSchema: z.object({
    total: z.number(),
    meals: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        mealTypes: z.array(mealType),
        proteinType: z.string().nullable(),
        isFavorite: z.boolean(),
        isOwnRecipe: z.boolean(),
      }),
    ),
  }),
  run: async (household, input) => {
    const { meals, total } = await loadMeals(household, {
      search: input.search,
      mealType: input.mealType,
      limit: input.limit,
    })
    return {
      total,
      meals: meals.map((meal) => ({
        id: meal.id,
        name: meal.name,
        mealTypes: meal.suitableFor,
        proteinType: meal.primaryProteinType,
        isFavorite: meal.isFavorite,
        isOwnRecipe: meal.isCustom,
      })),
    }
  },
})
