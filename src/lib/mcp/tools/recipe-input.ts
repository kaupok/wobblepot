import 'server-only'

import { z } from 'zod'

import { ProteinType } from '@/generated/prisma/enums'
import { fuzzySearchIngredient } from '@/lib/ai/fuzzy-ingredient-match'
import { type MatchedIngredient, matchIngredients } from '@/lib/ai/match-ingredients'
import type { ExtractedIngredient } from '@/lib/ai/recipe-schema'
import { translateIngredientNames, translateMatchResults } from '@/lib/ai/translate-match-results'
import type { HouseholdMealComponentInput } from '@/lib/household-meals'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import type { McpHousehold } from '@/lib/mcp/context'
import { MAX_MEAL_COMPONENTS } from '@/lib/meal-planning/components-schema'
import type { ComponentForProtein } from '@/lib/meal-planning/protein'
import { mealFieldsSchema, proteinTypeOverrideSchema } from '@/lib/meals/meal-fields-schema'

import { isMeasured, MEASURED_UNITS } from './measured-units'

/**
 * The recipe input that `create_meal` saves and `update_meal` changes
 * (HON-1305, HON-1314), and the one matching step both run on its
 * ingredients, so the two ways an assistant writes a recipe refuse the same
 * names and amounts.
 */

/** A recipe's own fields, as `create_meal` takes them; `update_meal` makes each optional. */
export const recipeFields = {
  name: z.string().trim().pipe(mealFieldsSchema.shape.name).describe('The recipe’s name.'),
  suitableFor: mealFieldsSchema.shape.suitableFor.describe(
    'The meal types this recipe suits: breakfast, lunch, dinner.',
  ),
  // Imagine and import write it, and nothing writes it again, so the caller
  // keeps it true to the ingredients (HON-1502).
  description: mealFieldsSchema.shape.description.describe(
    'One or two sentences on what the dish is like, shown with its name. It must agree with the ingredients. In update_meal, null clears it.',
  ),
  servings: mealFieldsSchema.shape.servings.describe('How many servings the quantities make.'),
  kidFriendly: mealFieldsSchema.shape.kidFriendly.describe('True if children eat it happily.'),
  preparationNotes: mealFieldsSchema.shape.preparationNotes.describe(
    'How to make it, in the user’s words.',
  ),
  timeMinutes: mealFieldsSchema.shape.timeMinutes.describe('Total time to make it, in minutes.'),
  // The household's chosen main protein (HON-1387); `update_meal` makes it
  // nullable, for back to automatic.
  mainProtein: proteinTypeOverrideSchema
    .unwrap()
    .optional()
    .describe(
      'The protein the household plans this recipe by, for its badge. Leave it out unless the main protein is not the ingredient with the most protein, for example mince with beans, where the beef is the point. It must be the protein of one of the recipe’s ingredients. In update_meal, null goes back to automatic.',
    ),
}

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
      .describe(
        'The amount for the whole recipe in unit, as bought: dry pasta, rice and lentils, drained canned beans, bone-in cuts and whole fish by weight with the bone. Null for a vague amount.',
      ),
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

export const ingredientsInput = z.array(ingredientInput).min(1).max(MAX_MEAL_COMPONENTS)

export const confirmedAmountsInput = z
  .array(z.string().trim().toLowerCase().min(1).max(200))
  .max(MAX_MEAL_COMPONENTS)
  .default([])
  .describe(
    'Names from check whose amounts the user said are right. Set only after asking the user.',
  )

const unitOutput = z.enum(MEASURED_UNITS)

export const ingredientsOutput = z.array(
  z.object({
    name: z.string(),
    quantity: z.number().nullable(),
    unit: unitOutput,
    note: z.string().nullable(),
  }),
)

export const unmatchedOutput = z
  .array(
    z.object({
      name: z.string(),
      original: z.string(),
      alternatives: z.array(z.string()),
    }),
  )
  .describe('For unmatched: each name without a sure match, and the closest ingredients.')

export const checkOutput = z
  .array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unit: unitOutput,
      warning: z.string(),
    }),
  )
  .describe('For check_quantity: each matched ingredient, its amount per serving, and why.')

export const mainProteinOutput = z.object({
  type: z.enum(ProteinType),
  setBy: z.enum(['household', 'automatic']),
})

/** How `mainProteinOutput` reads, for each tool's own description. */
export const MAIN_PROTEIN_HELP =
  'The protein the recipe is planned by, for its badge. setBy household: the household chose it; automatic: the ingredient with the most protein.'

export const proteinTypesOutput = z
  .array(z.enum(ProteinType))
  .describe('For check_protein: the protein types of the recipe’s ingredients.')

/** The stored main protein, and whether the household chose it. */
export function mainProteinOf(meal: {
  primaryProteinType: ProteinType
  proteinTypeOverride: ProteinType | null
}): z.output<typeof mainProteinOutput> {
  return {
    type: meal.primaryProteinType,
    setBy: meal.proteinTypeOverride ? 'household' : 'automatic',
  }
}

/** The matched lines as the protein rule reads them, for `check_protein`'s types. */
export function proteinComponentsOf(
  matched: MatchedIngredient[],
  servings: number,
): ComponentForProtein[] {
  return matched.map((m) => ({
    quantityPerServing: m.convertedQuantity / servings,
    isVague: m.isVague,
    ingredient: m.ingredient,
  }))
}

type RecipeIngredientMatch =
  | { outcome: 'unmatched'; unmatched: z.output<typeof unmatchedOutput> }
  | { outcome: 'check_quantity'; check: z.output<typeof checkOutput> }
  | { outcome: 'matched'; matched: MatchedIngredient[] }

/**
 * Match each line to one of the household's or the shared ingredients. Any
 * unsure name refuses the whole list, and then any amount the matcher flags
 * that the user has not confirmed does.
 */
export async function matchRecipeIngredients(
  household: McpHousehold,
  ingredients: z.output<typeof ingredientsInput>,
  servings: number,
  confirmedAmounts: string[],
): Promise<RecipeIngredientMatch> {
  const locale = resolveHouseholdLocale(household)
  const searchOptions = { householdId: household.id, locale }
  const results = await translateMatchResults(
    await matchIngredients(ingredients.map(extractedOf), servings, searchOptions),
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
    return { outcome: 'unmatched', unmatched }
  }

  const matched = results as MatchedIngredient[]

  // The assistant converts units itself, so a slip such as 500 piece for
  // 500 g saves a wrong shopping list that nobody sees. The matcher's
  // warning refuses the whole recipe, as an unsure name does, until the
  // user confirms the amount: 2 l of broth for 3 servings is real.
  const confirmed = new Set(confirmedAmounts)
  const check = matched.flatMap((m) =>
    m.quantityWarning && !confirmed.has(m.ingredient.name.toLowerCase())
      ? [
          {
            name: m.ingredient.name,
            quantity: Math.round((m.convertedQuantity / servings) * 10) / 10,
            unit: displayUnit(m.ingredient),
            warning: m.quantityWarning,
          },
        ]
      : [],
  )
  if (check.length > 0) return { outcome: 'check_quantity', check }

  return { outcome: 'matched', matched }
}

/** The matched lines as the recipe stores them. */
export function componentsOf(matched: MatchedIngredient[]): HouseholdMealComponentInput[] {
  return matched.map((m) => ({
    ingredientId: m.ingredient.id,
    // A vague row stores no quantity, as the app's create route stores it.
    totalQuantity: m.isVague ? 0 : m.convertedQuantity,
    isVague: m.isVague,
    originalPhrase: m.originalPhrase ?? null,
  }))
}

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
