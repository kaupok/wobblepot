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
import { getCookServings, sumPortions } from '@/lib/meal-planning/servings'
import { applyEntryChanges } from '@/lib/meal-planning/entry-components'
import { visibleMealWhere } from '@/lib/meals/load-meals'
import { defineTool, ToolInputError, type McpHousehold } from '@/lib/mcp/context'
import { findPlanSlot, slotInput } from './plan-slot'
import { MAIN_PROTEIN_HELP, mainProteinOf, mainProteinOutput } from './recipe-input'

const mealType = z.enum(['breakfast', 'lunch', 'dinner'])

export const getMeal = defineTool({
  name: 'get_meal',
  title: 'Get meal',
  description:
    "Returns one meal: its ingredients scaled to a number of servings, preparation notes when the recipe has them, and nutrition per serving. Use it after get_meal_plan or list_meals, with their mealId, to answer what goes into a meal or how to make it. For a planned meal, also pass the entry's date and mealType from get_meal_plan: the household may have changed that entry's ingredients (an ingredient replaced, left out or added), and the answer then lists what they will cook, at the entry's servings.",
  inputSchema: z.object({
    mealId: z.string().min(1).max(100).describe('The id from get_meal_plan or list_meals.'),
    servings: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe(
        "How many servings to scale the ingredients to. Defaults to the entry's cookServings for a planned meal, which counts the leftovers planned from it, else the household's usual servings.",
      ),
    date: slotInput.date
      .optional()
      .describe('For a planned meal: the day, YYYY-MM-DD, as get_meal_plan reports it.'),
    mealType: slotInput.mealType
      .optional()
      .describe('For a planned meal: the meal of that day. Pass it with date.'),
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
      mainProtein: mainProteinOutput.describe(
        `${MAIN_PROTEIN_HELP} A shared recipe is always automatic.`,
      ),
    }),
  }),
  run: async (household, { mealId, servings: requestedServings, date, mealType }) => {
    const locale = resolveHouseholdLocale(household)
    const entry = await findPlannedEntry(household, mealId, date, mealType)
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
        primaryProteinType: true,
        proteinTypeOverride: true,
        components: {
          select: {
            ingredientId: true,
            quantityPerServing: true,
            isVague: true,
            originalPhrase: true,
            ingredient: mcpIngredientArgs(locale),
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
    // A planned entry can override the household's servings (guests), and
    // cooks for its leftover lunches too (HON-1394), so the amounts are the
    // entry's cook servings unless the caller passes its own.
    const servings =
      requestedServings ??
      (entry
        ? getCookServings(entry, sumPortions(household.members))
        : sumPortions(household.members))
    // The planned entry's own changes merged over the recipe (HON-1243), so
    // the assistant reads what the household will cook.
    const components = entry
      ? applyEntryChanges(meal.components, await loadEntryChanges(entry.id, locale))
      : meal.components
    const nutrition = computeMealNutrition(components)

    return {
      meal: {
        id: meal.id,
        name: translated.name,
        description: translated.description ?? null,
        mealTypes: meal.suitableFor,
        timeMinutes: meal.timeMinutes,
        servings,
        ingredients: components.map((component) => {
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
        // A shared recipe never carries an override, so it reads automatic.
        mainProtein: mainProteinOf(meal),
      },
    }
  },
})

function mcpIngredientArgs(locale: string) {
  return {
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
  } as const
}

/**
 * The household's entry for the slot, when the caller named one. It must hold
 * this meal: an assistant that mixed up two days would otherwise read one
 * meal's recipe with another entry's changes.
 */
async function findPlannedEntry(
  household: McpHousehold,
  mealId: string,
  date: string | undefined,
  mealType: z.output<typeof slotInput.mealType> | undefined,
) {
  if (date === undefined && mealType === undefined) return null
  if (date === undefined || mealType === undefined) {
    throw new ToolInputError('Pass date and mealType together, or neither.')
  }
  const slot = await findPlanSlot(household, date, mealType)
  if (slot.mealId !== mealId) {
    throw new ToolInputError(
      `The ${mealType} on ${date} is not this meal. Use the mealId get_meal_plan returned for that entry.`,
    )
  }
  return slot
}

function loadEntryChanges(entryId: string, locale: string) {
  return prisma.mealPlanEntryComponent.findMany({
    where: { entryId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      originalIngredientId: true,
      replacementIngredientId: true,
      quantityPerServing: true,
      replacementIngredient: mcpIngredientArgs(locale),
    },
  })
}
