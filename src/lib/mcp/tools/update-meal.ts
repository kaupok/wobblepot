import 'server-only'
import { z } from 'zod'
import { getHouseholdMeal, HouseholdMealError, updateHouseholdMeal } from '@/lib/household-meals'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { discardMealImage } from '@/lib/meal-images/storage'
import { defineTool, WRITE_ANNOTATIONS, type McpHousehold } from '@/lib/mcp/context'
import {
  checkOutput,
  componentsOf,
  confirmedAmountsInput,
  ingredientsInput,
  ingredientsOutput,
  matchRecipeIngredients,
  recipeFields,
  unmatchedOutput,
} from './recipe-input'

const ROUTE = '/api/mcp'

export const updateMeal = defineTool({
  name: 'update_meal',
  title: 'Change a recipe',
  description:
    'Changes one of the household’s own recipes, the ones get_meal reports with isOwnRecipe true. Send only the fields to change; a field you leave out stays as it is. To change an ingredient, call get_meal first, then send ingredients with every ingredient of the recipe, also the unchanged ones: the list replaces all of them. Each ingredient is a name, a quantity for the whole recipe and a unit, as for create_meal. If a name has no sure match, nothing is changed and the name comes back in unmatched with the closest ingredients Wobblepot has; ask the user which one they meant, and call again. If an amount looks wrong for one serving, nothing is changed and outcome is check_quantity; ask the user, and call again with a corrected amount, or with the name from check in confirmedAmounts when the user says the amount is right. A shared recipe cannot be changed: outcome is notFound. No tool deletes a recipe.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    mealId: z.string().min(1).max(100).describe('The id from list_meals, get_meal or create_meal.'),
    name: recipeFields.name.optional(),
    suitableFor: recipeFields.suitableFor.optional(),
    servings: recipeFields.servings.optional(),
    // Unwrapped from create_meal's default of false, so an update that leaves
    // it out keeps the stored value.
    kidFriendly: recipeFields.kidFriendly.unwrap().describe('True if children eat it happily.'),
    preparationNotes: recipeFields.preparationNotes,
    timeMinutes: recipeFields.timeMinutes,
    ingredients: ingredientsInput
      .optional()
      .describe('Every ingredient of the recipe after the change. Replaces all of them.'),
    confirmedAmounts: confirmedAmountsInput,
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['updated', 'notFound', 'unmatched', 'check_quantity'])
      .describe(
        'updated: the recipe was changed. notFound: the household has no recipe with this id; a shared recipe answers this too. unmatched: some ingredients had no sure match, and nothing was changed. check_quantity: some amounts look wrong, and nothing was changed.',
      ),
    meal: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .describe('For updated: the recipe as saved.'),
    ingredients: ingredientsOutput.describe(
      'For updated: the ingredients as saved, for the whole recipe.',
    ),
    unmatched: unmatchedOutput,
    check: checkOutput,
  }),
  run: async (household, { mealId, ingredients, confirmedAmounts, ...fields }) => {
    const notFound = {
      outcome: 'notFound' as const,
      meal: null,
      ingredients: [],
      unmatched: [],
      check: [],
    }

    const current = await findLiveMeal(household, mealId)
    if (!current) return notFound

    let components
    if (ingredients) {
      const match = await matchRecipeIngredients(
        household,
        ingredients,
        fields.servings ?? current.servings,
        confirmedAmounts,
      )
      if (match.outcome === 'unmatched') {
        return { ...match, meal: null, ingredients: [], check: [] }
      }
      if (match.outcome === 'check_quantity') {
        return { ...match, meal: null, ingredients: [], unmatched: [] }
      }
      components = componentsOf(match.matched)
    }

    let update
    try {
      update = await updateHouseholdMeal(household.id, mealId, { ...fields, components })
    } catch (error) {
      // Deleted between the read above and the write.
      if (error instanceof HouseholdMealError && error.reason === 'mealNotFound') return notFound
      throw error
    }
    // After commit: a rolled-back edit must not have lost its image.
    await discardMealImage(update.discardedImageUrl, ROUTE)

    const saved = await findLiveMeal(household, mealId)
    if (!saved) return notFound

    return {
      outcome: 'updated' as const,
      meal: { id: saved.id, name: saved.name },
      ingredients: saved.components.map((c) => ({
        name: c.ingredient.name,
        quantity: c.isVague ? null : c.quantityPerServing * saved.servings,
        unit: displayUnit(c.ingredient),
        note: c.isVague ? c.originalPhrase : null,
      })),
      unmatched: [],
      check: [],
    }
  },
})

/** The household's own live recipe, in its locale, or null; a shared recipe is not one. */
async function findLiveMeal(household: McpHousehold, mealId: string) {
  try {
    const meal = await getHouseholdMeal(household.id, mealId, resolveHouseholdLocale(household))
    return meal.deletedAt ? null : meal
  } catch (error) {
    if (error instanceof HouseholdMealError && error.reason === 'mealNotFound') return null
    throw error
  }
}
