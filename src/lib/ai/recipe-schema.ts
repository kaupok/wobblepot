import { z } from 'zod'

/**
 * Extracted ingredient schema for AI structured output.
 *
 * NOTE: Anthropic's structured output API has limited JSON Schema support.
 * Avoid .positive(), .min(), .max(), .int() on numbers — these generate
 * unsupported properties (exclusiveMinimum, minimum, maximum).
 * Encode constraints in .describe() instead.
 */
const ExtractedIngredientSchema = z.object({
  name: z.string().describe('The ingredient name without quantity (e.g., "chicken breast")'),
  quantity: z
    .number()
    .nullable()
    .describe('The numeric quantity (must be > 0), or null if vague (e.g., "to taste")'),
  unit: z
    .enum(['g', 'piece', 'ml', 'tbsp', 'tsp', 'cup', 'oz', 'lb'])
    .nullable()
    .describe('The unit of measurement, or null if vague'),
  originalText: z
    .string()
    .describe('The original text from the recipe (e.g., "2 chicken breasts")'),
  isVague: z
    .boolean()
    .describe('True if quantity is vague (e.g., "to taste", "a pinch", "for garnish", "optional")'),
  vaguePhrase: z
    .string()
    .nullable()
    .describe('The vague phrase if isVague is true (e.g., "to taste", "a pinch")'),
  isDried: z
    .boolean()
    .nullable()
    .describe('For herbs, whether the ingredient is dried (e.g., "dried basil")'),
})

/**
 * Schema for AI structured output of recipe extraction.
 *
 * NOTE: Anthropic's structured output API has limited JSON Schema support.
 * Avoid .positive(), .min(), .max(), .int() on numbers — these generate
 * unsupported properties (exclusiveMinimum, minimum, maximum).
 * Encode constraints in .describe() instead.
 */
export const RecipeExtractionSchema = z.object({
  name: z.string().describe('The recipe name (1-200 chars)'),
  description: z
    .string()
    .nullable()
    .describe('A brief description of the dish (max 1000 chars), or null if not found'),
  preparationNotes: z
    .string()
    .nullable()
    .describe(
      'Distilled preparation steps from the recipe text (max 5000 chars). Strip noise (ads, life stories, navigation) and return only essential cooking steps in a clean, numbered format. Null if no preparation steps found.',
    ),
  timeMinutes: z
    .number()
    .nullable()
    .describe('Total prep + cook time in minutes (integer, 1-480), or null if not specified'),
  servings: z
    .number()
    .describe('Number of servings the recipe makes (integer, 1-50, default to 4 if not specified)'),
  mealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .describe('Which meal types this recipe is suitable for (at least one)'),
  kidFriendly: z
    .boolean()
    .describe('Whether this recipe is likely kid-friendly (no spicy ingredients, simple flavors)'),
  ingredients: z
    .array(ExtractedIngredientSchema)
    .describe('The list of ingredients with quantities (at least one)'),
  recipeConfidence: z
    .number()
    .describe(
      'How confident you are (0-100) that the input text contains an actual recipe with specific ingredients and quantities. 90-100 for structured recipes with clear ingredient lists. 50-89 for informal or partial recipes. Below 50 for non-recipe content (articles, stories, random text, code). If the text has no identifiable recipe at all, use 0-10.',
    ),
})

export type RecipeExtraction = z.infer<typeof RecipeExtractionSchema>
export type ExtractedIngredient = z.infer<typeof ExtractedIngredientSchema>
