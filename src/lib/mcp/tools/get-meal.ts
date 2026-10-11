import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { sumPortions } from '@/lib/meal-planning/servings'
import { visibleMealWhere } from '@/lib/meals/load-meals'
import { defineTool, ToolInputError } from '@/lib/mcp/context'

const mealType = z.enum(['breakfast', 'lunch', 'dinner'])

export const getMeal = defineTool({
  name: 'get_meal',
  title: 'Get meal',
  description:
    'Returns one meal: its ingredients scaled to a number of servings, preparation notes when the recipe has them, and nutrition per serving. Use it after get_meal_plan or list_meals, with their mealId, to answer what goes into a meal or how to make it. For a planned meal, pass the servings get_meal_plan returned for that entry.',
  inputSchema: z.object({
    mealId: z.string().min(1).max(100).describe('The id from get_meal_plan or list_meals.'),
    servings: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe(
        "How many servings to scale the ingredients to. Defaults to the household's usual servings.",
      ),
  }),
  outputSchema: z.object({
    meal: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      mealTypes: z.array(mealType),
      timeMinutes: z.number().nullable(),
      servings: z.number(),
      ingredients: z.array(
        z.object({
          name: z.string(),
          quantity: z.number().nullable(),
          unit: z.string(),
          note: z.string().nullable(),
        }),
      ),
      preparationNotes: z.string().nullable(),
      nutritionPerServing: z.object({
        calories: z.number(),
        protein: z.number(),
        carbs: z.number(),
        fat: z.number(),
      }),
      isOwnRecipe: z.boolean(),
      isFavorite: z.boolean(),
    }),
  }),
  run: async (household, { mealId, servings: requestedServings }) => {
    const locale = resolveHouseholdLocale(household)
    const meal = await prisma.meal.findFirst({
      // The shared catalogue or this household's own recipes, the same set
      // `list_meals` shows, so another household's recipe id finds nothing.
      // Or a meal on this household's plan: deleting a recipe keeps its plan
      // entries, and `get_meal_plan` still returns their mealId.
      where: {
        id: mealId,
        OR: [
          visibleMealWhere(household.id),
          { planEntries: { some: { plan: { householdId: household.id } } } },
        ],
      },
      select: {
        id: true,
        name: true,
        description: true,
        preparationNotes: true,
        timeMinutes: true,
        suitableFor: true,
        householdId: true,
        components: {
          select: {
            quantityPerServing: true,
            isVague: true,
            originalPhrase: true,
            ingredient: {
              select: {
                id: true,
                name: true,
                defaultUnit: true,
                measuredByVolume: true,
                gramsPerPiece: true,
                calories: true,
                protein: true,
                carbs: true,
                fat: true,
                ...ingredientTranslationsInclude(locale),
              },
            },
          },
        },
        favoritedBy: { where: { householdId: household.id }, select: { id: true } },
        ...mealTranslationsInclude(locale),
      },
    })

    if (!meal) {
      throw new ToolInputError(
        'No meal with this id is available to this household. Find one with list_meals.',
      )
    }

    const translated = translateMeal(meal, locale)
    // A planned entry can override the household's servings (guests), so the
    // caller passes the entry's servings from get_meal_plan.
    const servings = requestedServings ?? sumPortions(household.members)
    const nutrition = computeMealNutrition(meal.components)

    return {
      meal: {
        id: meal.id,
        name: translated.name,
        description: translated.description ?? null,
        mealTypes: meal.suitableFor,
        timeMinutes: meal.timeMinutes,
        servings,
        ingredients: meal.components.map((component) => {
          // A vague amount ("a pinch") is a phrase, not a number to scale.
          const vague = component.isVague && !!component.originalPhrase
          return {
            name: translateIngredient(component.ingredient, locale).name,
            quantity: vague ? null : component.quantityPerServing * servings,
            unit: displayUnit(component.ingredient),
            note: vague ? component.originalPhrase : null,
          }
        }),
        preparationNotes: translated.preparationNotes ?? null,
        nutritionPerServing: {
          calories: Math.round(nutrition.calories),
          protein: Math.round(nutrition.protein),
          carbs: Math.round(nutrition.carbs),
          fat: Math.round(nutrition.fat),
        },
        isOwnRecipe: meal.householdId !== null,
        isFavorite: meal.favoritedBy.length > 0,
      },
    }
  },
})
