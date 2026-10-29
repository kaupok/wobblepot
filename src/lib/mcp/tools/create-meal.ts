import 'server-only'

import { z } from 'zod'

import { createHouseholdMeal, findOwnMealByName, HouseholdMealError } from '@/lib/household-meals'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { defineTool, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { distinctProteinTypes } from '@/lib/meal-planning/protein'

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

export const createMeal = defineTool({
  name: 'create_meal',
  title: 'Save a recipe',
  description:
    'Saves a new recipe in the household’s own recipes, so it shows on the Recipes page and can be planned. Split each ingredient line into a name, a quantity for the whole recipe and a unit ("500 g veisehakkliha" is name veisehakkliha, quantity 500, unit g). Wobblepot matches each name to its ingredient list. If a name has no sure match, nothing is saved and the name comes back in unmatched with the closest ingredients Wobblepot has; ask the user which one they meant, or for another name, and call again with all the ingredients. If an amount looks wrong for one serving, nothing is saved and outcome is check_quantity with each such amount per serving; ask the user, and call again with all the ingredients: with a corrected amount, or with the name from check in confirmedAmounts when the user says the amount is right. If mainProtein is not the protein of any ingredient, nothing is saved and outcome is check_protein, with the protein types the recipe has; ask the user which one they meant, and call again. If the household already has a recipe with this name, nothing is saved and outcome is exists; use get_meal with its id, or ask the user for another name. A shared recipe with the same name does not stop the save. To change a saved recipe, use update_meal. To delete a recipe, use delete_meal.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...recipeFields,
    ingredients: ingredientsInput,
    confirmedAmounts: confirmedAmountsInput,
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['created', 'exists', 'unmatched', 'check_quantity', 'check_protein'])
      .describe(
        'created: the recipe was saved. exists: the household has a recipe with this name, and nothing was saved. unmatched: some ingredients had no sure match, and nothing was saved. check_quantity: some amounts look wrong, and nothing was saved. check_protein: no ingredient has mainProtein, and nothing was saved.',
      ),
    meal: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .describe('The saved recipe, or for exists the household’s recipe with this name.'),
    ingredients: ingredientsOutput.describe(
      'For created: the ingredients as saved, for the whole recipe.',
    ),
    mainProtein: mainProteinOutput.nullable().describe(`${MAIN_PROTEIN_HELP} Null unless created.`),
    unmatched: unmatchedOutput,
    check: checkOutput,
    proteinTypes: proteinTypesOutput,
  }),
  run: async (household, input) => {
    const existing = await findOwnMealByName(household.id, input.name)
    if (existing) {
      return {
        outcome: 'exists' as const,
        meal: existing,
        ingredients: [],
        mainProtein: null,
        unmatched: [],
        check: [],
        proteinTypes: [],
      }
    }

    const match = await matchRecipeIngredients(
      household,
      input.ingredients,
      input.servings,
      input.confirmedAmounts,
    )
    const refused = { meal: null, ingredients: [], mainProtein: null, proteinTypes: [] }
    if (match.outcome === 'unmatched') return { ...match, ...refused, check: [] }
    if (match.outcome === 'check_quantity') return { ...match, ...refused, unmatched: [] }
    const { matched } = match

    let meal
    try {
      meal = await createHouseholdMeal(household.id, {
        name: input.name,
        preparationNotes: input.preparationNotes,
        timeMinutes: input.timeMinutes,
        kidFriendly: input.kidFriendly,
        suitableFor: input.suitableFor,
        servings: input.servings,
        components: componentsOf(matched),
        proteinTypeOverride: input.mainProtein,
      })
    } catch (error) {
      // The lib owns the rule (HON-1386) and refuses before it writes.
      if (error instanceof HouseholdMealError && error.reason === 'proteinTypeNotInRecipe') {
        return {
          ...refused,
          outcome: 'check_protein' as const,
          unmatched: [],
          check: [],
          proteinTypes: distinctProteinTypes(proteinComponentsOf(matched, input.servings)),
        }
      }
      throw error
    }

    return {
      outcome: 'created' as const,
      meal: { id: meal.id, name: meal.name },
      ingredients: matched.map((m) => ({
        name: m.ingredient.name,
        quantity: m.isVague ? null : m.convertedQuantity,
        unit: displayUnit(m.ingredient),
        note: m.isVague ? (m.originalPhrase ?? null) : null,
      })),
      mainProtein: mainProteinOf(meal),
      unmatched: [],
      check: [],
      proteinTypes: [],
    }
  },
})
