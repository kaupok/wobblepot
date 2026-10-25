import 'server-only'
import { z } from 'zod'
import { fuzzySearchIngredient } from '@/lib/ai/fuzzy-ingredient-match'
import { matchIngredients, type MatchedIngredient } from '@/lib/ai/match-ingredients'
import type { ExtractedIngredient } from '@/lib/ai/recipe-schema'
import { translateIngredientNames, translateMatchResults } from '@/lib/ai/translate-match-results'
import { createHouseholdMeal, findOwnMealByName } from '@/lib/household-meals'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { MAX_MEAL_COMPONENTS } from '@/lib/meal-planning/components-schema'
import { mealFieldsSchema } from '@/lib/meals/meal-fields-schema'
import { defineTool, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { isMeasured, MEASURED_UNITS } from './measured-units'

const ingredientInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('The ingredient alone, in the user’s words: "veisehakkliha", "onion".'),
    quantity: z
      .number()
      .positive()
      .nullable()
      .describe('The amount for the whole recipe in unit. Null for a vague amount.'),
    unit: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(50)
      .describe(
        'g, ml or piece, or a vague amount such as "to taste" or "a pinch" with quantity null. Convert other units first: 1 tbsp is 15 ml.',
      ),
  })
  .refine((i) => (isMeasured(i.unit) ? i.quantity !== null : i.quantity === null), {
    message: 'g, ml and piece need a quantity; a vague amount has quantity null.',
  })

const unitOutput = z.enum(MEASURED_UNITS)

export const createMeal = defineTool({
  name: 'create_meal',
  title: 'Save a recipe',
  description:
    'Saves a new recipe in the household’s own recipes, so it shows on the Recipes page and can be planned. Split each ingredient line into a name, a quantity for the whole recipe and a unit ("500 g veisehakkliha" is name veisehakkliha, quantity 500, unit g). Wobblepot matches each name to its ingredient list. If a name has no sure match, nothing is saved and the name comes back in unmatched with the closest ingredients Wobblepot has; ask the user which one they meant, or for another name, and call again with all the ingredients. If an amount looks wrong for one serving, nothing is saved and outcome is check_quantity with each such amount per serving; confirm the amounts with the user and call again with all the ingredients and the corrected amounts. The same amount is refused again, so if the user means it, they save the recipe in the Wobblepot app. If the household already has a recipe with this name, nothing is saved and outcome is exists; use get_meal with its id, or ask the user for another name. A shared recipe with the same name does not stop the save. This tool cannot change or delete a recipe.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    name: z.string().trim().pipe(mealFieldsSchema.shape.name).describe('The recipe’s name.'),
    suitableFor: mealFieldsSchema.shape.suitableFor.describe(
      'The meal types this recipe suits: breakfast, lunch, dinner.',
    ),
    servings: mealFieldsSchema.shape.servings.describe('How many servings the quantities make.'),
    kidFriendly: mealFieldsSchema.shape.kidFriendly.describe('True if children eat it happily.'),
    preparationNotes: mealFieldsSchema.shape.preparationNotes.describe(
      'How to make it, in the user’s words.',
    ),
    timeMinutes: mealFieldsSchema.shape.timeMinutes.describe('Total time to make it, in minutes.'),
    ingredients: z.array(ingredientInput).min(1).max(MAX_MEAL_COMPONENTS),
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
    ingredients: z
      .array(
        z.object({
          name: z.string(),
          quantity: z.number().nullable(),
          unit: unitOutput,
          note: z.string().nullable(),
        }),
      )
      .describe('For created: the ingredients as saved, for the whole recipe.'),
    unmatched: z
      .array(
        z.object({
          name: z.string(),
          original: z.string(),
          alternatives: z.array(z.string()),
        }),
      )
      .describe('For unmatched: each name without a sure match, and the closest ingredients.'),
    check: z
      .array(
        z.object({
          name: z.string(),
          quantity: z.number(),
          unit: unitOutput,
          warning: z.string(),
        }),
      )
      .describe('For check_quantity: each matched ingredient, its amount per serving, and why.'),
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

    const locale = resolveHouseholdLocale(household)
    const searchOptions = { householdId: household.id, locale }
    const results = await translateMatchResults(
      await matchIngredients(input.ingredients.map(extractedOf), input.servings, searchOptions),
      locale,
    )

    // A guessed match gives a shopping list nobody checks, so one name
    // without a sure match refuses the whole recipe.
    const unsure = results.filter((r) => r.type === 'unmatched' || r.lowConfidence)
    if (unsure.length > 0) {
      const unmatched = await Promise.all(
        unsure.map(async (result) => {
          const candidates =
            result.type === 'matched'
              ? (result.alternatives ?? [])
              : await translateIngredientNames(
                  (await fuzzySearchIngredient(result.extractedName, searchOptions)).slice(0, 3),
                  locale,
                )
          return {
            name: result.extractedName,
            original: result.originalText,
            alternatives: candidates.map((c) => c.name),
          }
        }),
      )
      return { outcome: 'unmatched' as const, meal: null, ingredients: [], unmatched, check: [] }
    }

    const matched = results as MatchedIngredient[]

    // The assistant converts units itself, so a slip such as 500 piece for
    // 500 g saves a wrong shopping list that nobody sees. The matcher's
    // warning refuses the whole recipe, as an unsure name does.
    const check = matched.flatMap((m) =>
      m.quantityWarning
        ? [
            {
              name: m.ingredient.name,
              quantity: Math.round((m.convertedQuantity / input.servings) * 10) / 10,
              unit: displayUnit(m.ingredient),
              warning: m.quantityWarning,
            },
          ]
        : [],
    )
    if (check.length > 0) {
      return {
        outcome: 'check_quantity' as const,
        meal: null,
        ingredients: [],
        unmatched: [],
        check,
      }
    }

    const meal = await createHouseholdMeal(household.id, {
      name: input.name,
      preparationNotes: input.preparationNotes,
      timeMinutes: input.timeMinutes,
      kidFriendly: input.kidFriendly,
      suitableFor: input.suitableFor,
      servings: input.servings,
      components: matched.map((m) => ({
        ingredientId: m.ingredient.id,
        // A vague row stores no quantity, as the app's create route stores it.
        totalQuantity: m.isVague ? 0 : m.convertedQuantity,
        isVague: m.isVague,
        originalPhrase: m.originalPhrase ?? null,
      })),
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

/** The matcher's input for one ingredient line; a unit outside g, ml, piece is a vague phrase. */
function extractedOf({
  name,
  quantity,
  unit,
}: z.output<typeof ingredientInput>): ExtractedIngredient {
  const measured = isMeasured(unit)
  return {
    name,
    quantity: measured ? quantity : null,
    unit: measured ? unit : null,
    originalText: measured ? `${quantity} ${unit} ${name}` : `${name}, ${unit}`,
    isVague: !measured,
    vaguePhrase: measured ? null : unit,
    isDried: null,
  }
}
