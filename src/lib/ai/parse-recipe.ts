import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'

/**
 * Schema for a single extracted ingredient from recipe text.
 */
const ExtractedIngredientSchema = z.object({
  name: z.string().describe('The ingredient name without quantity (e.g., "chicken breast")'),
  quantity: z.number().positive().describe('The numeric quantity'),
  unit: z
    .enum(['g', 'piece', 'ml', 'tbsp', 'tsp', 'cup', 'oz', 'lb'])
    .describe('The unit of measurement'),
  originalText: z
    .string()
    .describe('The original text from the recipe (e.g., "2 chicken breasts")'),
})

/**
 * Schema for AI structured output of recipe extraction.
 */
export const RecipeExtractionSchema = z.object({
  name: z.string().min(1).max(200).describe('The recipe name'),
  description: z
    .string()
    .max(1000)
    .nullable()
    .describe('A brief description of the dish, or null if not found'),
  timeMinutes: z
    .number()
    .int()
    .positive()
    .max(480)
    .nullable()
    .describe('Total prep + cook time in minutes, or null if not specified'),
  servings: z
    .number()
    .int()
    .positive()
    .max(50)
    .describe('Number of servings the recipe makes, default to 4 if not specified'),
  mealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .min(1)
    .describe('Which meal types this recipe is suitable for'),
  kidFriendly: z
    .boolean()
    .describe('Whether this recipe is likely kid-friendly (no spicy ingredients, simple flavors)'),
  ingredients: z
    .array(ExtractedIngredientSchema)
    .min(1)
    .describe('The list of ingredients with quantities'),
})

export type RecipeExtraction = z.infer<typeof RecipeExtractionSchema>
export type ExtractedIngredient = z.infer<typeof ExtractedIngredientSchema>

/**
 * Error thrown when recipe parsing fails due to insufficient content.
 */
export class RecipeParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecipeParseError'
  }
}

/**
 * Build the prompt for recipe extraction.
 */
function buildRecipeExtractionPrompt(recipeText: string): string {
  return `You are a recipe parsing assistant. Extract structured data from the following recipe text.

IMPORTANT GUIDELINES:
1. Extract the recipe name, description, cooking time, servings, and ingredients
2. For ingredients, extract the quantity, unit, and ingredient name separately
3. Convert all quantities to standard units (g for weight, ml for volume, piece for countable items)
4. Common conversions:
   - 1 cup = 240ml (for liquids) or 120g (for flour) or 200g (for rice/grains)
   - 1 tbsp = 15ml or 15g
   - 1 tsp = 5ml or 5g
   - 1 oz = 28g
   - 1 lb = 454g
5. For "piece" items (eggs, chicken breasts, onions), use "piece" as unit
6. Determine meal types based on the recipe content (breakfast items like eggs/pancakes, lunch/dinner for mains)
7. Mark as kid-friendly if: no spicy ingredients, familiar foods, mild flavors
8. If servings aren't specified, default to 4
9. If cooking time isn't specified, leave it as null

RECIPE TEXT:
${recipeText}

Extract the structured recipe data. If the text doesn't contain enough information to extract a recipe (no clear ingredients or recipe name), return an error message explaining what's missing.`
}

/**
 * Parse recipe text using AI to extract structured data.
 * Throws RecipeParseError if the text doesn't contain enough information.
 */
export async function parseRecipeText(recipeText: string): Promise<RecipeExtraction> {
  const trimmedText = recipeText.trim()

  // Minimum sanity check
  if (trimmedText.length < 20) {
    throw new RecipeParseError(
      'The text is too short to be a recipe. Please paste a complete recipe with ingredients.',
    )
  }

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  const prompt = buildRecipeExtractionPrompt(trimmedText)

  try {
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-20250514'),
      schema: RecipeExtractionSchema,
      prompt,
    })

    // Validate we got meaningful data
    if (!object.name || object.ingredients.length === 0) {
      throw new RecipeParseError(
        "Couldn't extract a recipe from this text. Please make sure it includes a recipe name and list of ingredients.",
      )
    }

    return object
  } catch (error) {
    if (error instanceof RecipeParseError) {
      throw error
    }
    // AI generation error
    throw new RecipeParseError(
      'Failed to parse the recipe. Please try again or use the manual form.',
    )
  }
}

/**
 * Result of matching an ingredient against the database.
 */
export interface MatchedIngredient {
  type: 'matched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    gramsPerPiece: number | null
  }
  /** Quantity converted to the ingredient's default unit */
  convertedQuantity: number
}

export interface UnmatchedIngredient {
  type: 'unmatched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
}

export type IngredientMatchResult = MatchedIngredient | UnmatchedIngredient

/**
 * Result of the full recipe parsing and matching process.
 */
export interface ParsedRecipe {
  name: string
  description: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  ingredients: IngredientMatchResult[]
  allMatched: boolean
}

const SIMILARITY_THRESHOLD = 0.3

/**
 * Convert an extracted quantity and unit to the ingredient's default unit.
 */
function convertQuantity(
  quantity: number,
  fromUnit: string,
  ingredient: { defaultUnit: Unit; gramsPerPiece: number | null },
): number {
  const { defaultUnit, gramsPerPiece } = ingredient

  // Already in the right unit
  if (fromUnit === defaultUnit) {
    return quantity
  }

  // Convert to grams first (if needed)
  let grams: number

  switch (fromUnit) {
    case 'g':
      grams = quantity
      break
    case 'ml':
      // Approximate: assume density ~1 for most liquids
      grams = quantity
      break
    case 'piece':
      grams = gramsPerPiece ? quantity * gramsPerPiece : quantity * 100 // fallback
      break
    case 'tbsp':
      grams = quantity * 15
      break
    case 'tsp':
      grams = quantity * 5
      break
    case 'cup':
      grams = quantity * 240 // liquid approximation
      break
    case 'oz':
      grams = quantity * 28
      break
    case 'lb':
      grams = quantity * 454
      break
    default:
      grams = quantity
  }

  // Convert from grams to target unit
  if (defaultUnit === 'g') {
    return grams
  }

  if (defaultUnit === 'piece') {
    // Convert grams back to pieces
    if (gramsPerPiece && gramsPerPiece > 0) {
      return Math.round((grams / gramsPerPiece) * 10) / 10
    }
    // Can't convert, use original quantity as pieces
    return quantity
  }

  // Shouldn't happen, but fallback
  return grams
}

/**
 * Match extracted ingredients against the database using fuzzy search.
 */
export async function matchIngredients(
  extractedIngredients: ExtractedIngredient[],
): Promise<IngredientMatchResult[]> {
  const results: IngredientMatchResult[] = []

  for (const extracted of extractedIngredients) {
    // Normalize the name for searching
    const searchName = extracted.name.toLowerCase().trim()

    // Use pg_trgm similarity search
    const matches = await prisma.$queryRaw<
      Array<{
        id: string
        name: string
        category: IngredientCategory
        defaultUnit: Unit
        gramsPerPiece: number | null
        similarity: number
      }>
    >`
      SELECT
        id,
        name,
        category,
        "defaultUnit",
        "gramsPerPiece",
        similarity(name, ${searchName}) as similarity
      FROM "ingredient"
      WHERE similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}
      ORDER BY similarity DESC
      LIMIT 1
    `

    if (matches.length > 0 && matches[0]) {
      const match = matches[0]
      const convertedQuantity = convertQuantity(extracted.quantity, extracted.unit, match)

      results.push({
        type: 'matched',
        extractedName: extracted.name,
        extractedQuantity: extracted.quantity,
        extractedUnit: extracted.unit,
        originalText: extracted.originalText,
        ingredient: {
          id: match.id,
          name: match.name,
          category: match.category,
          defaultUnit: match.defaultUnit,
          gramsPerPiece: match.gramsPerPiece,
        },
        convertedQuantity,
      })
    } else {
      results.push({
        type: 'unmatched',
        extractedName: extracted.name,
        extractedQuantity: extracted.quantity,
        extractedUnit: extracted.unit,
        originalText: extracted.originalText,
      })
    }
  }

  return results
}

/**
 * Parse recipe text and match ingredients against the database.
 * This is the main entry point for the recipe import feature.
 */
export async function parseAndMatchRecipe(recipeText: string): Promise<ParsedRecipe> {
  // Step 1: Extract structured data from text
  const extraction = await parseRecipeText(recipeText)

  // Step 2: Match ingredients against database
  const ingredientResults = await matchIngredients(extraction.ingredients)

  // Step 3: Check if all ingredients matched
  const allMatched = ingredientResults.every((r) => r.type === 'matched')

  return {
    name: extraction.name,
    description: extraction.description,
    timeMinutes: extraction.timeMinutes,
    servings: extraction.servings,
    mealTypes: extraction.mealTypes as MealType[],
    kidFriendly: extraction.kidFriendly,
    ingredients: ingredientResults,
    allMatched,
  }
}
