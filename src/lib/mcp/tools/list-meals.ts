import 'server-only'
import { z } from 'zod'
import {
  loadMeals,
  MEALS_DEFAULT_LIMIT,
  MEALS_MAX_LIMIT,
  type MealSource,
} from '@/lib/meals/load-meals'
import { defineTool } from '@/lib/mcp/context'

const mealType = z.enum(['breakfast', 'lunch', 'dinner'])

/** The tool's words for the `loadMeals` sources it offers (HON-1306). */
const SOURCES = { own: 'custom', favourites: 'favorites' } as const satisfies Record<
  string,
  MealSource
>

export const listMeals = defineTool({
  name: 'list_meals',
  title: 'List meals',
  description:
    "Finds meals the household can plan: Wobblepot's shared recipes and the household's own, without those its allergies or excluded ingredients rule out. Use it to search by name or ingredient, to suggest a meal, or with source to list the household's own recipes or favourites, for example to plan from its rotation with plan_meal. Call get_meal with an id for the ingredients. Each meal carries lastCookedOn, cookedLast28Days and nextPlannedOn: use them, with order longestSinceCooked, to answer what the household has not had lately.",
  inputSchema: z.object({
    search: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Words in the meal name or an ingredient name. Tolerates typos.'),
    mealType: mealType.optional().describe('Only meals that suit this meal type.'),
    source: z
      .enum(['own', 'favourites'])
      .optional()
      .describe("own: only the household's own recipes. favourites: only its favourites."),
    order: z
      .enum(['longestSinceCooked'])
      .optional()
      .describe(
        'longestSinceCooked: the meal not cooked for longest first, then those never cooked, then those already planned. Ignored with search. Unset: by name.',
      ),
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
        lastCookedOn: z
          .string()
          .nullable()
          .describe(
            'The last day the household cooked it, YYYY-MM-DD. Skipped meals do not count.',
          ),
        cookedLast28Days: z.number().describe('How often it was cooked in the last 4 weeks.'),
        nextPlannedOn: z
          .string()
          .nullable()
          .describe('The next day it is planned, from today on, YYYY-MM-DD.'),
      }),
    ),
  }),
  run: async (household, input) => {
    const { meals, total } = await loadMeals(household, {
      search: input.search,
      mealType: input.mealType,
      limit: input.limit,
      order: input.order,
      ...(input.source ? { source: SOURCES[input.source] } : {}),
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
        lastCookedOn: meal.lastCookedOn,
        cookedLast28Days: meal.cookedLast28Days,
        nextPlannedOn: meal.nextPlannedOn,
      })),
    }
  },
})
