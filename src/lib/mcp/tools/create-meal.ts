import 'server-only'
import { z } from 'zod'
import { createHouseholdMeal, findOwnMealByName } from '@/lib/household-meals'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { defineTool, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
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

export const createMeal = defineTool({
  name: 'create_meal',
  title: 'Save a recipe',
  description:
    'Saves a new recipe in the household’s own recipes, so it shows on the Recipes page and can be planned. Split each ingredient line into a name, a quantity for the whole recipe and a unit ("500 g veisehakkliha" is name veisehakkliha, quantity 500, unit g). Wobblepot matches each name to its ingredient list. If a name has no sure match, nothing is saved and the name comes back in unmatched with the closest ingredients Wobblepot has; ask the user which one they meant, or for another name, and call again with all the ingredients. If an amount looks wrong for one serving, nothing is saved and outcome is check_quantity with each such amount per serving; ask the user, and call again with all the ingredients: with a corrected amount, or with the name from check in confirmedAmounts when the user says the amount is right. If the household already has a recipe with this name, nothing is saved and outcome is exists; use get_meal with its id, or ask the user for another name. A shared recipe with the same name does not stop the save. To change a saved recipe, use update_meal. No tool deletes a recipe.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...recipeFields,
    ingredients: ingredientsInput,
    confirmedAmounts: confirmedAmountsInput,
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['created', 'exists', 'unmatched', 'check_quantity'])
      .describe(
        'created: the recipe was saved. exists: the household has a recipe with this name, and nothing was saved. unmatched: some ingredients had no sure match, and nothing was saved. check_quantity: some amounts look wrong, and nothing was saved.',
      ),
    meal: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .describe('The saved recipe, or for exists the household’s recipe with this name.'),
    ingredients: ingredientsOutput.describe(
      'For created: the ingredients as saved, for the whole recipe.',
    ),
    unmatched: unmatchedOutput,
    check: checkOutput,
  }),
  run: async (household, input) => {
    const existing = await findOwnMealByName(household.id, input.name)
    if (existing) {
      return {
        outcome: 'exists' as const,
        meal: existing,
        ingredients: [],
        unmatched: [],
        check: [],
      }
    }

    const match = await matchRecipeIngredients(
      household,
      input.ingredients,
      input.servings,
      input.confirmedAmounts,
    )
    if (match.outcome === 'unmatched') {
      return { ...match, meal: null, ingredients: [], check: [] }
    }
    if (match.outcome === 'check_quantity') {
      return { ...match, meal: null, ingredients: [], unmatched: [] }
    }
    const { matched } = match

    const meal = await createHouseholdMeal(household.id, {
      name: input.name,
      preparationNotes: input.preparationNotes,
      timeMinutes: input.timeMinutes,
      kidFriendly: input.kidFriendly,
      suitableFor: input.suitableFor,
      servings: input.servings,
      components: componentsOf(matched),
    })

    return {
      outcome: 'created' as const,
      meal: { id: meal.id, name: meal.name },
      ingredients: matched.map((m) => ({
        name: m.ingredient.name,
        quantity: m.isVague ? null : m.convertedQuantity,
        unit: displayUnit(m.ingredient),
        note: m.isVague ? (m.originalPhrase ?? null) : null,
      })),
      unmatched: [],
      check: [],
    }
  },
})
