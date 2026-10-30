import 'server-only'

import { z } from 'zod'

import { HouseholdMealError, updateHouseholdMeal } from '@/lib/household-meals'
import { getHouseholdMeal } from '@/lib/household-meals-read'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, type McpHousehold, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { discardMealImage } from '@/lib/meal-images/storage'
import { type ComponentForProtein, distinctProteinTypes } from '@/lib/meal-planning/protein'

import {
  checkOutput,
  componentsOf,
  confirmedAmountsInput,
  ingredientsInput,
  ingredientsOutput,
  MAIN_PROTEIN_HELP,
  mainProteinOf,
  mainProteinOutput,
  matchRecipeIngredients,
  proteinComponentsOf,
  proteinTypesOutput,
  recipeFields,
  unmatchedOutput,
} from './recipe-input'

const ROUTE = '/api/mcp'

export const SERVINGS_REQUIRED =
  'Send servings with ingredients: the number of servings the amounts are for, for example the servings get_meal returned.'

export const updateMeal = defineTool({
  name: 'update_meal',
  title: 'Change a recipe',
  description:
    'Changes one of the household’s own recipes, the ones get_meal reports with isOwnRecipe true. Send only the fields to change; a field you leave out stays as it is. To change an ingredient, call get_meal first, then send ingredients with every ingredient of the recipe, also the unchanged ones: the list replaces all of them. Send servings with ingredients, and give each quantity for that many servings, with a name and a unit as for create_meal; servings is a whole number and get_meal can answer a half one, so first call get_meal with servings set to its recipeServings; copying that servings and those amounts is then correct. The recipe is then stored at that many servings. If a name has no sure match, nothing is changed and the name comes back in unmatched with the closest ingredients Wobblepot has; ask the user which one they meant, and call again. If an amount looks wrong for one serving, nothing is changed and outcome is check_quantity; ask the user, and call again with a corrected amount, or with the name from check in confirmedAmounts when the user says the amount is right. If mainProtein is not the protein of any ingredient, nothing is changed and outcome is check_protein, with the protein types the recipe has; ask the user which one they meant, and call again. A shared recipe cannot be changed: outcome is notFound. To delete a recipe, use delete_meal.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    mealId: z.string().min(1).max(100).describe('The id from list_meals, get_meal or create_meal.'),
    name: recipeFields.name.optional(),
    suitableFor: recipeFields.suitableFor.optional(),
    servings: recipeFields.servings
      .optional()
      .describe(
        'How many servings the recipe makes. Required with ingredients: the number of servings their quantities are for, a whole number such as the servings get_meal answered when called with servings set to recipeServings.',
      ),
    // Unwrapped from create_meal's default of false, so an update that leaves
    // it out keeps the stored value.
    kidFriendly: recipeFields.kidFriendly.unwrap().describe('True if children eat it happily.'),
    preparationNotes: recipeFields.preparationNotes,
    timeMinutes: recipeFields.timeMinutes,
    // Absent keeps the stored choice, null goes back to automatic: the
    // `proteinTypeOverride` patch's own meaning.
    mainProtein: recipeFields.mainProtein
      .unwrap()
      .nullable()
      .optional()
      .describe(recipeFields.mainProtein.description!),
    ingredients: ingredientsInput
      .optional()
      .describe(
        'Every ingredient of the recipe after the change, each quantity for servings. Replaces all of them.',
      ),
    confirmedAmounts: confirmedAmountsInput,
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['updated', 'notFound', 'unmatched', 'check_quantity', 'check_protein'])
      .describe(
        'updated: the recipe was changed. notFound: the household has no recipe with this id; a shared recipe answers this too. unmatched: some ingredients had no sure match, and nothing was changed. check_quantity: some amounts look wrong, and nothing was changed. check_protein: no ingredient has mainProtein, and nothing was changed.',
      ),
    meal: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .describe('For updated: the recipe as saved.'),
    servings: z
      .number()
      .nullable()
      .describe(
        'For updated: the servings the recipe is stored at. The ingredients amounts are for servings.',
      ),
    ingredients: ingredientsOutput.describe(
      'For updated: the ingredients as saved, each amount for servings.',
    ),
    mainProtein: mainProteinOutput.nullable().describe(`${MAIN_PROTEIN_HELP} Null unless updated.`),
    unmatched: unmatchedOutput,
    check: checkOutput,
    proteinTypes: proteinTypesOutput,
  }),
  run: async (household, { mealId, ingredients, confirmedAmounts, mainProtein, ...fields }) => {
    const refused = {
      meal: null,
      servings: null,
      ingredients: [],
      mainProtein: null,
      proteinTypes: [],
    }
    const notFound = { ...refused, outcome: 'notFound' as const, unmatched: [], check: [] }

    const current = await findLiveMeal(household, mealId)
    if (!current) return notFound

    let components
    // The components the protein rule checks: the new ingredients when sent, else the stored ones.
    let proteinComponents: ComponentForProtein[] = current.components
    if (ingredients) {
      // get_meal scales amounts to the cook's servings, not the stored ones, so the
      // caller must say which count its amounts are for (HON-1472).
      const { servings } = fields
      if (servings === undefined) throw new ToolInputError(SERVINGS_REQUIRED)
      const match = await matchRecipeIngredients(household, ingredients, servings, confirmedAmounts)
      if (match.outcome === 'unmatched') return { ...match, ...refused, check: [] }
      if (match.outcome === 'check_quantity') return { ...match, ...refused, unmatched: [] }
      components = componentsOf(match.matched)
      proteinComponents = proteinComponentsOf(match.matched, servings)
    }

    let update
    try {
      update = await updateHouseholdMeal(household.id, mealId, {
        ...fields,
        components,
        proteinTypeOverride: mainProtein,
      })
    } catch (error) {
      if (!(error instanceof HouseholdMealError)) throw error
      // Deleted between the read above and the write.
      if (error.reason === 'mealNotFound') return notFound
      // The lib owns the rule (HON-1386) and refuses before it writes.
      if (error.reason === 'proteinTypeNotInRecipe') {
        return {
          ...refused,
          outcome: 'check_protein' as const,
          unmatched: [],
          check: [],
          proteinTypes: distinctProteinTypes(proteinComponents),
        }
      }
      throw error
    }
    // After commit: a rolled-back edit must not have lost its image.
    await discardMealImage(update.discardedImageUrl, ROUTE)

    const saved = await findLiveMeal(household, mealId)
    if (!saved) return notFound

    return {
      outcome: 'updated' as const,
      meal: { id: saved.id, name: saved.name },
      servings: saved.servings,
      ingredients: saved.components.map((c) => ({
        name: c.ingredient.name,
        quantity: c.isVague ? null : c.quantityPerServing * saved.servings,
        unit: displayUnit(c.ingredient),
        note: c.isVague ? c.originalPhrase : null,
      })),
      mainProtein: mainProteinOf(saved),
      unmatched: [],
      check: [],
      proteinTypes: [],
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
